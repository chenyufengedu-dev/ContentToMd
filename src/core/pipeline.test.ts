import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { DEFAULT_PROMPTS } from './defaultPrompts'
import { AppError } from './errors'
import { newJob, runJob, type Job, type RunContext } from './pipeline'
import type { Fetch } from './services'

const TRANSCRIPT = '🎼商务礼仪的三个重点分享给大家。第一个重点呢叫做摆正位置。第二个重点呢叫做端正态度。'
const CLEANED = '商务礼仪的三个重点分享给大家。第一个重点呢叫做摆正位置。第二个重点呢叫做端正态度。'
const AI_RESULT = {
  title: '商务礼仪三重点',
  domain_id: 1,
  tags: ['商务礼仪'],
  keywords: ['摆正位置'],
  summary: '三个重点',
  body: '### 一、摆正位置\n\n尊重上级是我们的天职。',
}

/** 假服务：按地址分派，并记下各被调用了几次 */
function fakeServices(chatReplies: (() => Response)[], asrText = TRANSCRIPT) {
  const calls = { asr: 0, chat: 0 }
  const fetch: Fetch = async (url) => {
    if (url.endsWith('/audio/transcriptions')) {
      calls.asr++
      return new Response(JSON.stringify({ text: asrText }))
    }
    calls.chat++
    return chatReplies[Math.min(calls.chat - 1, chatReplies.length - 1)]()
  }
  return { fetch, calls }
}
const chatRaw = (content: string) => () =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
const chatOk = (content: unknown) => chatRaw(JSON.stringify(content))
const chatStatus = (status: number) => () => new Response('', { status })

/** “提取声音”要用 WebView 的解码器，测试里当作已完成，直接给两段音频 */
function jobAfterExtract(): Job {
  const job = newJob('商务礼仪.mp4', '视频', '要点提炼')
  job.steps[0].status = 'done'
  job.wavChunks = [new Blob(['a']), new Blob(['b'])]
  return job
}

function ctx(fetch: Fetch): RunContext {
  return {
    config: defaultConfig(),
    prompts: DEFAULT_PROMPTS,
    existingTags: [],
    fetch,
    readFile: async () => new ArrayBuffer(0),
    cancel: new AbortController().signal,
    onUpdate: () => {},
  }
}

describe('runJob', () => {
  it('逐段转写、去掉标记，再整理成草稿；音频用完就丢掉', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await runJob(job, ctx(fetch))
    expect(calls).toEqual({ asr: 2, chat: 1 })
    expect(job.transcript).toBe(`${CLEANED}\n${CLEANED}`)
    expect(job.draft?.title).toBe('商务礼仪三重点')
    expect(job.wavChunks).toBeUndefined()
    expect(job.steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])
  })

  it('整理失败后重试，只重跑整理，不重新转写（US6）', async () => {
    const { fetch, calls } = fakeServices([chatStatus(500), chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await expect(runJob(job, ctx(fetch))).rejects.toMatchObject({ code: 'unavailable' })
    expect(job.steps.map((s) => s.status)).toEqual(['done', 'done', 'failed'])
    await runJob(job, ctx(fetch))
    expect(calls).toEqual({ asr: 2, chat: 2 })
    expect(job.draft?.body).toContain('尊重上级')
  })

  it('AI 返回格式不对时自动重试 1 次', async () => {
    const { fetch, calls } = fakeServices([chatRaw('好的'), chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await runJob(job, ctx(fetch))
    expect(calls.chat).toBe(2)
    expect(job.draft?.title).toBe('商务礼仪三重点')
  })

  it('连续两次缺少必填字段就停下，不无限重试', async () => {
    const { fetch, calls } = fakeServices([chatOk({ title: '缺正文' })])
    await expect(runJob(jobAfterExtract(), ctx(fetch))).rejects.toMatchObject({ code: 'format' })
    expect(calls.chat).toBe(2)
  })

  it('密钥错误不自动重试', async () => {
    const { fetch, calls } = fakeServices([chatStatus(401)])
    await expect(runJob(jobAfterExtract(), ctx(fetch))).rejects.toMatchObject({ code: 'auth' })
    expect(calls.chat).toBe(1)
  })

  it('没有识别到语音时停下，不调用文字整理（方案第 8 节）', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)], '🎼嗯。')
    const err = await runJob(jobAfterExtract(), ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('no_speech')
    expect(calls.chat).toBe(0)
  })
})
