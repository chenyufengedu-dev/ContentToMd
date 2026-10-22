import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { DEFAULT_PROMPTS } from './defaultPrompts'
import { newTextJob, runJob, type RunContext } from './pipeline'
import type { Fetch } from './services'

const AI_RESULT = {
  title: '标题',
  domain_id: 1,
  tags: ['标签'],
  keywords: ['关键词'],
  summary: '摘要',
  body: '正文',
}

function ctx(fetch: Fetch): RunContext {
  return {
    config: defaultConfig(),
    prompts: DEFAULT_PROMPTS,
    existingTags: [],
    fetch,
    readFile: async () => new ArrayBuffer(0),
    toAiUrl: async () => '',
    readPixels: async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    cancel: new AbortController().signal,
    onUpdate: () => {},
  }
}

const reply = (note: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(note) }, finish_reason: 'stop' }] }))

describe('长文的整理', () => {
  const para = (c: string) => c.repeat(999) + '。'
  // 6 段每段 1000 字，共 6000 字，每块攒 2 段，分成 3 块
  const LONG = ['甲', '乙', '丙', '丁', '戊', '己'].map(para).join('\n')
  const filler = (n: number) => `正文${n}`.padEnd(2900, '。')

  /** 假服务：看请求里写的是第几段，回对应的内容；seen 记下每次请求的段号，peak 是同时在跑的最多个数 */
  function chunkFetch(bodyFor: (n: number, attempt: number) => string) {
    const seen: number[] = []
    const inflight = { now: 0, peak: 0 }
    const fetch: Fetch = async (_url, init) => {
      const msg = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[1].content
      const n = Number(/第 (\d+)\/\d+ 段/.exec(msg)![1])
      seen.push(n)
      const attempt = seen.filter((x) => x === n).length
      inflight.now++
      inflight.peak = Math.max(inflight.peak, inflight.now)
      await new Promise((ok) => setTimeout(ok, 5))
      inflight.now--
      return reply({ ...AI_RESULT, title: `第${n}段标题`, tags: [`标签${n}`], body: bodyFor(n, attempt) })
    }
    return { fetch, seen, inflight }
  }

  it('原文精修：分块各自精修再按顺序拼起来；标题、领域取第一块，标签合并；同时最多 3 块', async () => {
    const { fetch, seen, inflight } = chunkFetch((n) => filler(n))
    const job = newTextJob('长文.pdf', LONG, '原文精修', '文档')
    await runJob(job, ctx(fetch))
    expect([...seen].sort()).toEqual([1, 2, 3])
    expect(inflight.peak).toBeLessThanOrEqual(3)
    expect(job.draft?.title).toBe('第1段标题')
    expect(job.draft?.tags).toEqual(['标签1', '标签2', '标签3'])
    const body = job.draft!.body
    expect(body.startsWith('正文1')).toBe(true)
    expect(body.indexOf('正文2')).toBeGreaterThan(body.indexOf('正文1'))
    expect(body.indexOf('正文3')).toBeGreaterThan(body.indexOf('正文2'))
  })

  it('某一块的输出比原文短了四成以上（被改成摘要）就自动重试一次', async () => {
    const { fetch, seen } = chunkFetch((n, attempt) => (n === 2 && attempt === 1 ? '只有摘要' : filler(n)))
    const job = newTextJob('长文.pdf', LONG, '原文精修', '文档')
    await runJob(job, ctx(fetch))
    expect(seen.filter((x) => x === 2)).toHaveLength(2)
    expect(job.draft?.body).not.toContain('只有摘要')
  })

  it('原文精修 4000 字以内一次整理，不分块', async () => {
    let calls = 0
    const fetch: Fetch = async () => (calls++, reply(AI_RESULT))
    await runJob(newTextJob('短.txt', '短'.repeat(3900), '原文精修'), ctx(fetch))
    expect(calls).toBe(1)
  })

  it('超过上限的内容整理时直接报错，不调用服务', async () => {
    let calls = 0
    const fetch: Fetch = async () => (calls++, reply(AI_RESULT))
    await expect(runJob(newTextJob('太长.txt', '长'.repeat(50001), '原文精修'), ctx(fetch))).rejects.toMatchObject({
      code: 'too_long',
    })
    expect(calls).toBe(0)
  })

  it('要点提炼一次装整段，不分块', async () => {
    let calls = 0
    const fetch: Fetch = async () => (calls++, reply(AI_RESULT))
    await runJob(newTextJob('长.txt', '长'.repeat(30000), '要点提炼'), ctx(fetch))
    expect(calls).toBe(1)
  })
})

describe('长文精修失败后重试', () => {
  const para = (c: string) => c.repeat(999) + '。'
  const LONG = ['甲', '乙', '丙', '丁', '戊', '己'].map(para).join('\n')

  it('已经精修好的块留着，重试时只补失败的那一块', async () => {
    const seen: number[] = []
    let failSecond = true
    const fetch: Fetch = async (_url, init) => {
      const msg = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[1].content
      const n = Number(/第 (\d+)\/\d+ 段/.exec(msg)![1])
      seen.push(n)
      if (n === 2 && failSecond) return new Response('', { status: 500 })
      return reply({ ...AI_RESULT, title: `第${n}段标题`, tags: [`标签${n}`], body: `正文${n}`.padEnd(2900, '。') })
    }
    const job = newTextJob('长文.pdf', LONG, '原文精修', '文档')
    await expect(runJob(job, ctx(fetch))).rejects.toMatchObject({ code: 'unavailable' })
    expect([...seen].sort()).toEqual([1, 2, 3])
    seen.length = 0
    failSecond = false
    await runJob(job, ctx(fetch))
    expect(seen).toEqual([2])
    expect(job.draft?.tags).toEqual(['标签1', '标签2', '标签3'])
    expect(job.draft?.body.indexOf('正文3')).toBeGreaterThan(job.draft!.body.indexOf('正文2'))
  })
})
