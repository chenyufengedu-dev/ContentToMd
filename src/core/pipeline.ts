// 一条内容的处理流程。音视频：提取声音 → 转写 → 整理；图片：读取图片 → 看图整理（整理完顺便算出自动裁剪框）。
// 每一步的结果都留在 job 里，重试时从失败的那一步继续，已经付过费的步骤不再重复（方案第 6.2 节）

import type { Config, ServiceKind } from './config'
import { decodeTo16kMono, splitChunks, toWav, cleanTranscript, effectiveLength } from './audio'
import { transcribe, chatJson, type Fetch } from './services'
import { AppError, isAppError } from './errors'
import { retryOnRateLimit } from './retry'
import { CONCURRENCY, isCondensed, lengthProblem, mapPool, REFINE_SINGLE_MAX, splitTextChunks } from './longText'
import { estimateCost, keyId, type Usage, type UsageRecord } from './cost'
import { autoCrop, type Pixels, type Rect } from './image'
import {
  buildSystemPrompt,
  buildUserMessage,
  parseAiResult,
  previewText,
  type Mode,
  type NoteDraft,
  type Prompts,
  type SourceType,
} from './note'

export type StepId = 'extract' | 'transcribe' | 'read' | 'organize'
export const STEP_LABELS: Record<StepId, string> = {
  extract: '提取声音',
  transcribe: '转写',
  read: '读取图片',
  organize: '整理',
}

export interface StepState {
  id: StepId
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt?: number
  endedAt?: number
  note?: string // 比如“第 2/3 段”
}

/** 一张图片：原文件、发给看图服务的压缩版、自动裁剪框和用户调整后的裁剪框（null 表示不裁） */
export interface JobImage {
  file: File
  aiUrl?: string
  autoCrop?: Rect | null
  crop?: Rect | null
}

export interface Job {
  fileName: string
  type: SourceType
  mode: Mode
  steps: StepState[]
  // 每一步的结果
  wavChunks?: Blob[]
  duration?: number
  transcript?: string
  draft?: NoteDraft
  domainFallback?: boolean
  images?: JobImage[]
  /** 用户填的来源链接（选填），写进笔记的 source */
  source?: string
  /** 粘贴的分享文字原文（F02）：解析出的平台、作者写进笔记，原文一起发给 AI 帮它认专有名词 */
  shareText?: string
  platform?: string
  author?: string
  /** 本次要求（F04），空的就按默认规则 */
  request?: string
  /** 这一条到目前为止的估算花费（元，F14）；有调用不知道价格时 costUnknown */
  cost?: number
  costUnknown?: boolean
  /** 确认页里改到一半的内容（标题、属性、正文 Markdown），存进草稿，恢复时接着改（F10） */
  edits?: NoteDraft
  /** 整理时 AI 已经生成的文字（去掉了格式），处理中的预览框一个字一个字显示 */
  preview?: string
}

export function newJob(fileName: string, type: SourceType, mode: Mode): Job {
  const ids: StepId[] = ['extract', 'transcribe', 'organize']
  return { fileName, type, mode, steps: ids.map((id) => ({ id, status: 'pending' })) }
}

/** MD / TXT（F07）、PDF / Word（F15、F16，type 为“文档”）：放入时已经解出文字，只剩整理一步；文字放在 transcript，确认页的原文对照照常用 */
export function newTextJob(fileName: string, text: string, mode: Mode, type: SourceType = '文字'): Job {
  return { fileName, type, mode, steps: [{ id: 'organize', status: 'pending' }], transcript: text }
}

export function newImageJob(files: File[], mode: Mode): Job {
  const ids: StepId[] = ['read', 'organize']
  return {
    fileName: files[0]?.name ?? '',
    type: '图片',
    mode,
    steps: ids.map((id) => ({ id, status: 'pending' })),
    images: files.map((file) => ({ file })),
  }
}

export interface RunContext {
  config: Config
  prompts: Prompts
  existingTags: string[]
  fetch: Fetch
  readFile: () => Promise<ArrayBuffer>
  /** 图片压缩成发给看图服务的 data URL、读出像素：要用 WebView 的画布，由界面注入（见 image.ts） */
  toAiUrl: (b: Blob) => Promise<string>
  readPixels: (b: Blob) => Promise<Pixels>
  cancel: AbortSignal
  onUpdate: () => void
  /** 每调用一次服务记一笔费用（F14），由界面写进 usage.jsonl */
  onUsage?: (r: UsageRecord) => void
  /** 429 重试前的等待；测试里换成不等 */
  sleep?: (ms: number) => Promise<void>
}

/** 记一笔费用：加到这一条的花费上，再交给界面存起来 */
async function recordUsage(job: Job, ctx: RunContext, kind: ServiceKind, usage?: Usage) {
  const s = ctx.config.services[kind]
  const at = new Date()
  const cost = estimateCost(s.price, usage)
  // 转写不按 tokens 计价，不算进这一条的花费；整理、看图没填价格时这一条的花费就不知道
  if (kind !== 'asr') {
    if (cost === null) job.costUnknown = true
    else job.cost = (job.cost ?? 0) + cost
  }
  ctx.onUsage?.({
    time: at.toISOString(),
    service: kind,
    model: s.model.trim(),
    keyId: await keyId(s.apiKey),
    cost,
    tokens: usage,
    item: job.fileName,
  })
}

/** 调服务：遇到 429 自动等一会儿再试，等的时候在这一步旁边写“N 秒后自动重试” */
function call<T>(fn: () => Promise<T>, ctx: RunContext, step: StepState): Promise<T> {
  const before = step.note
  return retryOnRateLimit(
    async () => {
      const r = await fn()
      step.note = before
      return r
    },
    {
      cancel: ctx.cancel,
      sleep: ctx.sleep,
      onWait: (s) => {
        step.note = `请求太频繁，${s} 秒后自动重试`
        ctx.onUpdate()
      },
    },
  )
}

/** 从第一个没完成的步骤开始跑到底；出错时把该步标为失败并抛出 */
export async function runJob(job: Job, ctx: RunContext): Promise<void> {
  for (const step of job.steps) {
    if (step.status === 'done') continue
    step.status = 'running'
    step.startedAt = Date.now()
    step.endedAt = undefined
    step.note = undefined
    ctx.onUpdate()
    try {
      await STEPS[step.id](job, ctx, step)
      step.status = 'done'
    } catch (e) {
      step.status = 'failed'
      throw e
    } finally {
      step.endedAt = Date.now()
      ctx.onUpdate()
    }
  }
}

const STEPS: Record<StepId, (job: Job, ctx: RunContext, step: StepState) => Promise<void>> = {
  async extract(job, ctx) {
    const { samples, duration } = await decodeTo16kMono(await ctx.readFile())
    job.wavChunks = splitChunks(samples).map(toWav)
    job.duration = duration
  },

  async transcribe(job, ctx, step) {
    const chunks = job.wavChunks!
    const texts: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1) {
        step.note = `第 ${i + 1}/${chunks.length} 段`
        ctx.onUpdate()
      }
      const raw = await call(() => transcribe(ctx.config.services.asr, chunks[i], ctx.fetch, ctx.cancel), ctx, step)
      await recordUsage(job, ctx, 'asr')
      texts.push(cleanTranscript(raw))
    }
    const text = texts.join('\n')
    if (effectiveLength(text) < 20) throw new AppError('no_speech', '没有识别到语音，可以改为提供截图')
    job.transcript = text
    job.wavChunks = undefined // 音频用完就丢掉，不长期保存（方案第 10.5 节）
  },

  async read(job, ctx) {
    for (const img of job.images!) img.aiUrl ??= await ctx.toAiUrl(img.file)
  },

  async organize(job, ctx, step) {
    const system = buildSystemPrompt(ctx.prompts, job.mode, ctx.config.domains, ctx.existingTags)
    const images = job.images
    const kind = images ? 'vision' : 'text'
    const extra = { shareText: job.shareText, request: job.request }
    const onText = (soFar: string) => {
      job.preview = previewText(soFar)
      ctx.onUpdate()
    }
    if (!images) {
      const problem = lengthProblem(job.mode, job.transcript!.length)
      if (problem) throw new AppError('too_long', problem)
      // 原文精修要把全文重写一遍，太长时一次装不稳（会被悄悄改成摘要），分块并行精修
      if (job.mode === '原文精修' && job.transcript!.length > REFINE_SINGLE_MAX)
        return organizeInChunks(job, ctx, step, system, extra, onText)
    }
    const user = images
      ? [
          {
            type: 'text',
            text: buildUserMessage(
              `${images.length} 张图片`,
              `材料是下面的 ${images.length} 张图片，按顺序是第 1～${images.length} 张。`,
              extra,
            ),
          },
          ...images.map((i) => ({ type: 'image_url', image_url: { url: i.aiUrl! } })),
        ]
      : buildUserMessage(sourceDesc(job), job.transcript!, extra)
    // 返回格式不对时自动重试 1 次（方案第 8 节）
    for (let attempt = 0; ; attempt++) {
      try {
        const parsed = await askOnce(job, ctx, step, kind, system, user, onText)
        job.draft = parsed.draft
        job.domainFallback = parsed.domainFallback
        if (images) await cropAll(images, parsed.imageRegions, ctx)
        return
      } catch (e) {
        if (!isAppError(e, 'format') || attempt >= 1) throw e
      }
    }
  },
}

/** 发给 AI 的“来源”一行：文字文件、文档、音视频的语音转写 */
const sourceDesc = (job: Job) =>
  job.type === '文字' || job.type === '文档'
    ? `${job.type === '文字' ? '文字文件' : '文档'}（${job.fileName}）`
    : `${job.type}（语音转写）`

/** 调一次整理服务并校验结果。服务回了话就记一笔费用（没带用量时金额记为不知道），连不上、超时这些没花钱的不记；
 * 返回格式不对要重试时，这次也已经花了钱，照样记 */
async function askOnce(
  job: Job,
  ctx: RunContext,
  step: StepState,
  kind: 'text' | 'vision',
  system: string,
  user: string | unknown[],
  onText?: (soFar: string) => void,
) {
  let used: Usage | undefined
  let answered = false
  try {
    const parsed = parseAiResult(
      await call(
        () =>
          chatJson(
            kind,
            ctx.config.services[kind],
            system,
            user,
            ctx.fetch,
            ctx.cancel,
            onText,
            (u) => (used = u),
          ).then((v) => ((answered = true), v)),
        ctx,
        step,
      ),
      ctx.config.domains,
    )
    if (!parsed) throw new AppError('format', 'AI 返回的结果缺少标题或正文，请点击重试')
    return parsed
  } finally {
    if (used || answered) await recordUsage(job, ctx, kind, used)
  }
}

/**
 * 长文的原文精修：切成每块约 3000 字，同时最多 3 块一起精修，按顺序拼起来（依据：docs/进度.md 的长文实测）。
 * 标题、摘要、领域取第一块，标签和关键词各块合并。某一块的输出比原文短了四成以上（被改成摘要）时自动重试一次
 */
async function organizeInChunks(
  job: Job,
  ctx: RunContext,
  step: StepState,
  system: string,
  extra: { shareText?: string; request?: string },
  onText: (soFar: string) => void,
) {
  const chunks = splitTextChunks(job.transcript!)
  let done = 0
  const parts = await mapPool(chunks, CONCURRENCY, async (chunk, i) => {
    const user = buildUserMessage(
      `${sourceDesc(job)}，长文的第 ${i + 1}/${chunks.length} 段，只整理这一段（标题、摘要按这一段写，小标题接着前文）`,
      chunk,
      extra,
    )
    for (let attempt = 0; ; attempt++) {
      try {
        // 打字机预览只跟第一块
        const parsed = await askOnce(job, ctx, step, 'text', system, user, i === 0 ? onText : undefined)
        if (attempt === 0 && isCondensed(chunk.length, parsed.draft.body.length)) continue
        step.note = `已完成 ${++done}/${chunks.length} 段`
        ctx.onUpdate()
        return parsed
      } catch (e) {
        if (!isAppError(e, 'format') || attempt >= 1) throw e
      }
    }
  })
  const first = parts[0]
  job.draft = {
    ...first.draft,
    tags: [...new Set(parts.flatMap((p) => p.draft.tags))].slice(0, 8),
    keywords: [...new Set(parts.flatMap((p) => p.draft.keywords))].slice(0, 12),
    body: parts.map((p) => p.draft.body).join('\n\n'),
  }
  job.domainFallback = first.domainFallback
}

/** 自动裁剪（F29）：读不出像素时那张图就不裁，不让整条失败 */
async function cropAll(images: JobImage[], regions: unknown[], ctx: RunContext) {
  for (const [i, img] of images.entries()) {
    try {
      img.autoCrop = autoCrop(await ctx.readPixels(img.file), regions[i])
    } catch {
      img.autoCrop = null
    }
    img.crop = img.autoCrop
  }
}
