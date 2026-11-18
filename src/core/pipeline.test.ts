import { describe, expect, it } from 'vitest'
import { defaultConfig, parseConfig } from './config'
import { DEFAULT_PROMPTS, resolvePrompts } from './defaultPrompts'
import { AppError } from './errors'
import { newImageJob, newJob, newTextJob, runJob, type Job, type RunContext } from './pipeline'
import type { Fetch } from './services'
import type { UsageRecord } from './cost'

const TRANSCRIPT = '🎼读书笔记的三个重点分享给大家。第一个重点呢叫做记录问题。第二个重点呢叫做摘录线索。'
const CLEANED = '读书笔记的三个重点分享给大家。第一个重点呢叫做记录问题。第二个重点呢叫做摘录线索。'
const AI_RESULT = {
  title: '读书笔记三重点',
  domain_id: 1,
  tags: ['读书笔记'],
  keywords: ['记录问题'],
  summary: '三个重点',
  body: '### 一、记录问题\n\n摘录原句要记出处页码。',
}

/** 假服务：按地址分派，并记下各被调用了几次 */
function fakeServices(chatReplies: (() => Response)[], asrText = TRANSCRIPT) {
  const calls = { asr: 0, chat: 0, bodies: [] as unknown[], urls: [] as string[] }
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith('/audio/transcriptions')) {
      calls.asr++
      return new Response(JSON.stringify({ text: asrText }))
    }
    calls.chat++
    calls.urls.push(url)
    calls.bodies.push(JSON.parse(String(init?.body)))
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
  const job = newJob('读书笔记.mp4', '视频', '要点提炼')
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
    // 图片工具要用 WebView 的画布，测试里换成假的：AI 版本就是文件名，像素是 100×100 的白图
    toAiUrl: async (b) => `data:fake,${(b as File).name}`,
    readPixels: async () => ({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 }),
    cancel: new AbortController().signal,
    onUpdate: () => {},
  }
}

describe('runJob', () => {
  it('重读保存配置后使用所选指令，保留通用格式和导入字体配置', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const context = ctx(fetch)
    const instruction = '优先列出可操作的步骤。'
    const font = { family: 'ctmd-font-test', name: 'Example.ttf', data: 'AA==' }
    context.config = parseConfig(
      JSON.stringify({
        ...context.config,
        interfaceFont: font.family,
        importedFonts: [font],
        promptFiles: [{ id: 'second', mode: '要点提炼', name: 'example.md', text: instruction }],
        promptFileSelections: { 要点提炼: 'second' },
        promptOverrides: { 要点提炼: instruction },
      }),
    )
    expect(context.config.interfaceFont).toBe(font.family)
    expect(context.config.importedFonts).toEqual([font])
    expect(context.config.promptFileSelections?.要点提炼).toBe('second')
    context.prompts = resolvePrompts(DEFAULT_PROMPTS, context.config)
    await runJob(jobAfterExtract(), context)
    const request = calls.bodies[0] as { messages: { content: string }[] }
    expect(request.messages[0].content).toContain(instruction)
    expect(request.messages[0].content).toContain('JSON')
  })

  it('逐段转写、去掉标记，再整理成草稿；音频用完就丢掉', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await runJob(job, ctx(fetch))
    expect([calls.asr, calls.chat]).toEqual([2, 1])
    expect(job.transcript).toBe(`${CLEANED}\n${CLEANED}`)
    expect(job.draft?.title).toBe('读书笔记三重点')
    expect(job.wavChunks).toBeUndefined()
    expect(job.steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])
  })

  it('整理失败后重试，只重跑整理，不重新转写（US6）', async () => {
    const { fetch, calls } = fakeServices([chatStatus(500), chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await expect(runJob(job, ctx(fetch))).rejects.toMatchObject({ code: 'unavailable' })
    expect(job.steps.map((s) => s.status)).toEqual(['done', 'done', 'failed'])
    await runJob(job, ctx(fetch))
    expect([calls.asr, calls.chat]).toEqual([2, 2])
    expect(job.draft?.body).toContain('摘录原句')
  })

  it('AI 返回格式不对时自动重试 1 次', async () => {
    const { fetch, calls } = fakeServices([chatRaw('好的'), chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    await runJob(job, ctx(fetch))
    expect(calls.chat).toBe(2)
    expect(job.draft?.title).toBe('读书笔记三重点')
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

describe('runJob：图片', () => {
  const images = () => [
    new File(['1'], 'a.png', { type: 'image/png' }),
    new File(['2'], 'b.png', { type: 'image/png' }),
  ]

  it('读取图片 → 看图整理；图片按顺序作为看图服务的输入', async () => {
    const result = { ...AI_RESULT, image_captions: ['首页', '详情'], image_regions: [[0, 0.1, 1, 0.8]] }
    const { fetch, calls } = fakeServices([chatOk(result)])
    const job = newImageJob(images(), '视觉收藏')
    await runJob(job, ctx(fetch))
    expect(job.steps.map((s) => [s.id, s.status])).toEqual([
      ['read', 'done'],
      ['organize', 'done'],
    ])
    expect(calls.asr).toBe(0)
    expect(calls.urls[0]).toContain('/chat/completions')
    const body = calls.bodies[0] as { messages: { content: unknown }[] }
    expect(String(body.messages[0].content)).toContain('## 整理方式：视觉收藏')
    const parts = body.messages[1].content as { type: string; image_url?: { url: string } }[]
    expect(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url!.url)).toEqual([
      'data:fake,a.png',
      'data:fake,b.png',
    ])
    expect(job.draft?.image_captions).toEqual(['首页', '详情'])
  })

  it('整理完按 AI 给的主体区域算出自动裁剪框；没有区域的图只去纯色边', async () => {
    const result = { ...AI_RESULT, image_regions: [[0, 0.1, 1, 0.8]] }
    const { fetch } = fakeServices([chatOk(result)])
    const job = newImageJob(images(), '视觉收藏')
    await runJob(job, ctx(fetch))
    // 假像素是整张白图：第一张按区域裁到 y 10～90，再去纯色边时整块都是纯色，保持区域；第二张不用裁
    expect(job.images?.map((i) => i.autoCrop)).toEqual([{ x: 0, y: 10, w: 100, h: 80 }, null])
    expect(job.images?.map((i) => i.crop)).toEqual([{ x: 0, y: 10, w: 100, h: 80 }, null])
  })

  it('图片类型默认用看图服务的配置', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const c = ctx(fetch)
    c.config.services.vision.baseUrl = 'https://vision.example.com/v1'
    await runJob(newImageJob(images(), '要点提炼'), c)
    expect(calls.urls[0]).toBe('https://vision.example.com/v1/chat/completions')
  })

  it('每次调用记一笔费用：转写免费，整理按用量估算，加到这一条的花费上（F14）', async () => {
    const usage = { prompt_tokens: 2000, completion_tokens: 1000 }
    const withUsage = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(AI_RESULT) }, finish_reason: 'stop' }],
          usage,
        }),
      )
    const { fetch } = fakeServices([withUsage])
    const job = jobAfterExtract()
    const c = ctx(fetch)
    c.config.services.text.apiKey = 'sk-test'
    c.config.services.text.price = { input: 2, output: 8 }
    const records: UsageRecord[] = []
    await runJob(job, { ...c, onUsage: (r) => records.push(r) })
    expect(records.map((r) => r.service)).toEqual(['asr', 'asr', 'text'])
    expect(records[2]).toMatchObject({ model: 'deepseek-flash', tokens: usage, item: '读书笔记.mp4' })
    expect(records[2].keyId).toHaveLength(8)
    expect(records[2].cost).toBeCloseTo((2000 * 2 + 1000 * 8) / 1e6, 10)
    // 转写没有按 tokens 的价格，不影响这一条的花费
    expect(job.cost).toBeCloseTo(records[2].cost!, 10)
    expect(job.costUnknown).toBeFalsy()
  })

  it('转写按音频时长和用户填的每小时价格算钱，计入这一条的花费（F14）', async () => {
    const withUsage = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(AI_RESULT) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000 },
        }),
      )
    const { fetch } = fakeServices([withUsage])
    const job = jobAfterExtract()
    // 两段各 60 秒的 16kHz 单声道 WAV
    const wav60 = new Blob([new Uint8Array(44 + 16000 * 2 * 60)])
    job.wavChunks = [wav60, wav60]
    const c = ctx(fetch)
    c.config.services.asr.apiKey = 'sk-asr'
    c.config.services.asr.price = { perHour: 3.6 }
    c.config.services.text.apiKey = 'sk-test'
    c.config.services.text.price = { input: 2, output: 8 }
    const records: UsageRecord[] = []
    await runJob(job, { ...c, onUsage: (r) => records.push(r) })
    const asr = records.filter((r) => r.service === 'asr')
    expect(asr.map((r) => r.seconds)).toEqual([60, 60])
    expect(asr[0].cost).toBeCloseTo(0.06, 10)
    // 转写 0.12 元 + 整理 (1000 × 2 + 1000 × 8) / 1e6
    expect(job.cost).toBeCloseTo(0.12 + 0.01, 10)
    expect(job.costUnknown).toBeFalsy()
  })

  it('转写没填价格（比如免费模型）：不算钱也不算“不知道”，整理填了价格这一条就有花费', async () => {
    const withUsage = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(AI_RESULT) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000 },
        }),
      )
    const { fetch } = fakeServices([withUsage])
    const job = jobAfterExtract()
    const c = ctx(fetch)
    c.config.services.text.apiKey = 'sk-test'
    c.config.services.text.price = { input: 2, output: 8 }
    await runJob(job, c)
    expect(job.cost).toBeCloseTo(0.01, 10)
    expect(job.costUnknown).toBeFalsy()
  })

  it('没填价格：只记用量和次数，这一条的花费不知道（F14）', async () => {
    const { fetch } = fakeServices([chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    const records: UsageRecord[] = []
    await runJob(job, { ...ctx(fetch), onUsage: (r) => records.push(r) })
    expect(records.every((r) => r.cost === null)).toBe(true)
    expect(job.cost).toBeUndefined()
    expect(job.costUnknown).toBe(true)
  })

  it('整理时 429：自动等一会儿再试，成功后不用用户点重试（方案第 8 节）', async () => {
    const { fetch, calls } = fakeServices([chatStatus(429), chatOk(AI_RESULT)])
    const job = newTextJob('会议记录.txt', '决定下周上线', '原文精修')
    const notes: (string | undefined)[] = []
    const c = { ...ctx(fetch), sleep: async () => {}, onUpdate: () => notes.push(job.steps[0].note) }
    await runJob(job, c)
    expect(calls.chat).toBe(2)
    expect(notes).toContain('请求受限，5 秒后自动重试。')
    expect(job.steps[0].note).toBeUndefined()
    expect(job.draft?.title).toBe('读书笔记三重点')
  })

  it('文字文件：只有整理一步，原文和本次要求都发给 AI（F07、F04）', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const job = newTextJob('会议记录.txt', '决定下周上线', '原文精修')
    job.request = '只保留决定事项'
    await runJob(job, ctx(fetch))
    expect(job.steps.map((s) => s.id)).toEqual(['organize'])
    expect(job.transcript).toBe('决定下周上线')
    const user = (calls.bodies[0] as { messages: { content: string }[] }).messages[1].content
    expect(user).toContain('本次要求：只保留决定事项')
    expect(user).toContain('<<<材料开始>>>\n决定下周上线')
    expect(job.draft?.title).toBe('读书笔记三重点')
  })

  it('PDF / Word（文档）：来源标成“文档”，不当成语音转写（F15、F16）', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const job = newTextJob('合同.pdf', '第一条 甲方', '原文精修', '文档')
    await runJob(job, ctx(fetch))
    expect(job.type).toBe('文档')
    const user = (calls.bodies[0] as { messages: { content: string }[] }).messages[1].content
    expect(user).toContain('文档（合同.pdf）')
    expect(user).not.toContain('语音转写')
  })

  it('提取内容：图片按导入顺序写入正文，没有文字的那张留空；选区只影响识别范围', async () => {
    const result = {
      ...AI_RESULT,
      summary: '',
      body: '这段是整理结果，不应该出现在提取正文里',
      image_captions: ['聊天截图', '白板'],
      image_texts: ['第一条消息\n第二条消息', ''],
      image_regions: [],
    }
    const { fetch, calls } = fakeServices([chatOk(result)])
    const area = { x: 10, y: 20, w: 60, h: 30 }
    const job = newImageJob(
      [
        { file: new File(['1'], '聊天.png', { type: 'image/png' }), region: area },
        { file: new File(['2'], '白板.png', { type: 'image/png' }) },
      ],
      '提取内容',
    )
    const seen: unknown[] = []
    await runJob(job, {
      ...ctx(fetch),
      toAiUrl: async (b, crop) => {
        seen.push(crop ?? null)
        return `data:fake,${(b as File).name}`
      },
    })
    expect(seen).toEqual([area, null])
    expect(job.draft?.body).toBe('### 第 1 张\n\n第一条消息\n第二条消息')
    expect(job.draft?.summary).toBe('')
    expect(job.images?.map((i) => i.crop)).toEqual(job.images?.map((i) => i.region ?? null))
    expect(calls.chat).toBe(1)
  })

  it('提取内容：视频把转写直接放进草稿，不再调用文字整理', async () => {
    const { fetch, calls } = fakeServices([chatOk(AI_RESULT)])
    const job = jobAfterExtract()
    job.mode = '提取内容'
    await runJob(job, ctx(fetch))
    expect(calls.chat).toBe(0)
    expect(job.draft).toMatchObject({ body: `${CLEANED}\n${CLEANED}`, summary: '', tags: [], keywords: [] })
  })
})
it('长文一段失败后会取消其他分段请求', async () => {
  const job = newTextJob('long.md', '这一段是需要保留的会议记录。\n\n'.repeat(500), '原文精修')
  const signals: AbortSignal[] = []
  const fetch: Fetch = async (_url, init) => {
    signals.push(init!.signal!)
    if (signals.length === 1) return chatStatus(400)()
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
  }
  const controller = new AbortController()
  try {
    await expect(runJob(job, { ...ctx(fetch), cancel: controller.signal })).rejects.toBeDefined()
    expect(signals.length).toBeGreaterThan(1)
    expect(signals.slice(1).every((signal) => signal.aborted)).toBe(true)
  } finally {
    controller.abort()
  }
})
it('分段转写失败后只重试未完成的音频段', async () => {
  const job = jobAfterExtract()
  const calls: number[] = []
  let fail = true
  const fetch: Fetch = async (url, init) => {
    if (!url.endsWith('/audio/transcriptions')) return chatOk(AI_RESULT)()
    const file = (init?.body as FormData).get('file') as Blob
    const part = (await file.text()) === 'a' ? 1 : 2
    calls.push(part)
    if (part === 2 && fail) return chatStatus(500)()
    return new Response(JSON.stringify({ text: part === 1 ? CLEANED : '这是转写得到的第二部分。' }))
  }
  await expect(runJob(job, ctx(fetch))).rejects.toMatchObject({ code: 'unavailable' })
  fail = false
  await runJob(job, ctx(fetch))
  expect(calls).toEqual([1, 2, 2])
  expect(job.transcript).toBe(CLEANED + '\n这是转写得到的第二部分。')
})
