// 一条音视频的处理流程：提取声音 → 转写 → 整理。
// 每一步的结果都留在 job 里，重试时从失败的那一步继续，已经付过费的步骤不再重复（方案第 6.2 节）

import type { Config } from './config'
import { decodeTo16kMono, splitChunks, toWav, cleanTranscript, effectiveLength } from './audio'
import { transcribe, chatJson, type Fetch } from './services'
import { AppError, isAppError } from './errors'
import {
  buildSystemPrompt,
  buildUserMessage,
  parseAiResult,
  type Mode,
  type NoteDraft,
  type Prompts,
  type SourceType,
} from './note'

export type StepId = 'extract' | 'transcribe' | 'organize'
export const STEP_LABELS: Record<StepId, string> = { extract: '提取声音', transcribe: '转写', organize: '整理' }

export interface StepState {
  id: StepId
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt?: number
  endedAt?: number
  note?: string // 比如“第 2/3 段”
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
}

export function newJob(fileName: string, type: SourceType, mode: Mode): Job {
  const ids: StepId[] = ['extract', 'transcribe', 'organize']
  return { fileName, type, mode, steps: ids.map((id) => ({ id, status: 'pending' })) }
}

export interface RunContext {
  config: Config
  prompts: Prompts
  existingTags: string[]
  fetch: Fetch
  readFile: () => Promise<ArrayBuffer>
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

  async organize(job, ctx) {
    const system = buildSystemPrompt(ctx.prompts, job.mode, ctx.config.domains, ctx.existingTags)
    const user = buildUserMessage(`${job.type}（语音转写）`, job.transcript!)
    // 返回格式不对时自动重试 1 次（方案第 8 节）
    for (let attempt = 0; ; attempt++) {
      try {
        const parsed = parseAiResult(
          await chatJson('text', ctx.config.services.text, system, user, ctx.fetch, ctx.cancel),
          ctx.config.domains,
        )
        if (!parsed) throw new AppError('format', 'AI 返回的结果缺少标题或正文，请点击重试')
        job.draft = parsed.draft
        job.domainFallback = parsed.domainFallback
        return
      } catch (e) {
        if (!isAppError(e, 'format') || attempt >= 1) throw e
      }
    }
  },
}
