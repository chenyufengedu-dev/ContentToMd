// 一条内容的处理流程。音视频：提取声音 → 转写 → 整理；图片：读取图片 → 看图整理（整理完顺便算出自动裁剪框）。
// 每一步的结果都留在 job 里，重试时从失败的那一步继续，已经付过费的步骤不再重复（方案第 6.2 节）

import type { Config } from './config'
import { decodeTo16kMono, splitChunks, toWav, cleanTranscript, effectiveLength } from './audio'
import { transcribe, chatJson, type Fetch } from './services'
import { AppError, isAppError } from './errors'
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
  /** 整理时 AI 已经生成的文字（去掉了格式），处理中的预览框一个字一个字显示 */
  preview?: string
}

export function newJob(fileName: string, type: SourceType, mode: Mode): Job {
  const ids: StepId[] = ['extract', 'transcribe', 'organize']
  return { fileName, type, mode, steps: ids.map((id) => ({ id, status: 'pending' })) }
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
      texts.push(cleanTranscript(await transcribe(ctx.config.services.asr, chunks[i], ctx.fetch, ctx.cancel)))
    }
    const text = texts.join('\n')
    if (effectiveLength(text) < 20) throw new AppError('no_speech', '没有识别到语音，可以改为提供截图')
    job.transcript = text
    job.wavChunks = undefined // 音频用完就丢掉，不长期保存（方案第 10.5 节）
  },

  async read(job, ctx) {
    for (const img of job.images!) img.aiUrl ??= await ctx.toAiUrl(img.file)
  },

  async organize(job, ctx) {
    const system = buildSystemPrompt(ctx.prompts, job.mode, ctx.config.domains, ctx.existingTags)
    const images = job.images
    const kind = images ? 'vision' : 'text'
    const user = images
      ? [
          {
            type: 'text',
            text: buildUserMessage(
              `${images.length} 张图片`,
              `材料是下面的 ${images.length} 张图片，按顺序是第 1～${images.length} 张。`,
            ),
          },
          ...images.map((i) => ({ type: 'image_url', image_url: { url: i.aiUrl! } })),
        ]
      : buildUserMessage(`${job.type}（语音转写）`, job.transcript!)
    // 返回格式不对时自动重试 1 次（方案第 8 节）
    for (let attempt = 0; ; attempt++) {
      try {
        const parsed = parseAiResult(
          await chatJson(kind, ctx.config.services[kind], system, user, ctx.fetch, ctx.cancel, (soFar) => {
            job.preview = previewText(soFar)
            ctx.onUpdate()
          }),
          ctx.config.domains,
        )
        if (!parsed) throw new AppError('format', 'AI 返回的结果缺少标题或正文，请点击重试')
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
