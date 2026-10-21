import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { AppError, type ErrorCode } from './errors'
import { chatJson, transcribe, type Fetch } from './services'

const text = { ...defaultConfig().services.text, apiKey: 'sk-test' }
const asr = { ...defaultConfig().services.asr, apiKey: 'sk-test' }
const respond =
  (status: number, body: unknown): Fetch =>
  async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

async function codeOf(p: Promise<unknown>): Promise<ErrorCode | 'no-error'> {
  try {
    await p
    return 'no-error'
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
}

describe('服务返回的错误按错误码分类（方案第 8 节）', () => {
  const cases: [number, unknown, ErrorCode][] = [
    [401, { error: { message: 'Authentication Fails' } }, 'auth'],
    [403, 'forbidden', 'auth'],
    [402, { error: { message: 'Insufficient Balance' } }, 'balance'],
    [400, { error: { message: 'The supported API model names are deepseek-flash' } }, 'not_found'],
    [404, 'not found', 'not_found'],
    [429, 'too many', 'rate_limit'],
    [500, 'oops', 'unavailable'],
  ]
  for (const [status, body, code] of cases) {
    it(`HTTP ${status} → ${code}`, async () => {
      expect(await codeOf(chatJson('text', text, 's', 'u', respond(status, body)))).toBe(code)
    })
  }

  it('密钥无效的提示写出是哪项服务', async () => {
    await expect(chatJson('text', text, 's', 'u', respond(401, ''))).rejects.toThrow(
      '文字整理服务的密钥无效，请到设置中检查',
    )
  })

  it('http 地址不发请求 → insecure_url', async () => {
    let called = false
    const spy: Fetch = async () => {
      called = true
      return new Response('{}')
    }
    const insecure = { ...text, baseUrl: 'http://api.deepseek.com' }
    expect(await codeOf(chatJson('text', insecure, 's', 'u', spy))).toBe('insecure_url')
    expect(called).toBe(false)
  })

  it('断网 → network', async () => {
    const offline: Fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await codeOf(chatJson('text', text, 's', 'u', offline))).toBe('network')
  })

  it('用户取消 → cancelled', async () => {
    const ctrl = new AbortController()
    const hang: Fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const p = chatJson('text', text, 's', 'u', hang, ctrl.signal)
    ctrl.abort()
    expect(await codeOf(p)).toBe('cancelled')
  })
})

describe('chatJson', () => {
  const ok = (content: string, finish = 'stop') =>
    respond(200, { choices: [{ message: { content }, finish_reason: finish }] })

  it('返回解析后的 JSON', async () => {
    expect(await chatJson('text', text, 's', 'u', ok('{"title":"标题"}'))).toEqual({ title: '标题' })
  })

  it('不是合法 JSON → format', async () => {
    expect(await codeOf(chatJson('text', text, 's', 'u', ok('好的，下面是整理结果')))).toBe('format')
  })

  it('输出被截断 → truncated', async () => {
    expect(await codeOf(chatJson('text', text, 's', 'u', ok('{"title":', 'length')))).toBe('truncated')
  })

  it('请求里带上 JSON 格式要求、指令、材料和密钥', async () => {
    let sent: RequestInit | undefined
    const spy: Fetch = async (_url, init) => {
      sent = init
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
    }
    await chatJson('text', text, '系统指令', '材料', spy)
    const body = JSON.parse(String(sent?.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([
      { role: 'system', content: '系统指令' },
      { role: 'user', content: '材料' },
    ])
    expect((sent?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })
})

describe('transcribe', () => {
  it('返回转写文字，地址拼成 /audio/transcriptions', async () => {
    let url = ''
    const f: Fetch = async (u) => {
      url = u
      return new Response(JSON.stringify({ text: '商务礼仪的三个重点分享给大家' }))
    }
    expect(await transcribe(asr, new Blob(['x']), f)).toBe('商务礼仪的三个重点分享给大家')
    expect(url).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  })

  it('返回结构不对 → bad_response', async () => {
    expect(await codeOf(transcribe(asr, new Blob(['x']), respond(200, { result: 'x' })))).toBe('bad_response')
  })
})

describe('chatJson 边生成边返回（方案第 11 节：整理结果一边生成一边显示）', () => {
  /** 按服务商的流式格式（SSE）把内容分几段吐出来 */
  const sse =
    (pieces: string[], finish = 'stop'): Fetch =>
    async () => {
      const lines = pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`)
      lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`, 'data: [DONE]\n\n')
      const body = new ReadableStream({
        start(c) {
          // 一行一块送出；第一行再故意拆成两块，模拟网络分包
          const enc = new TextEncoder()
          const first = enc.encode(lines[0])
          c.enqueue(first.slice(0, 7))
          c.enqueue(first.slice(7))
          for (const l of lines.slice(1)) c.enqueue(enc.encode(l))
          c.close()
        },
      })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    }

  it('逐段回调已生成的内容，最后返回解析后的 JSON', async () => {
    const seen: string[] = []
    const r = await chatJson('text', text, 's', 'u', sse(['{"title":', '"商务', '礼仪"}']), undefined, (t) =>
      seen.push(t),
    )
    expect(r).toEqual({ title: '商务礼仪' })
    expect(seen.at(-1)).toBe('{"title":"商务礼仪"}')
    expect(seen.length).toBeGreaterThan(1)
  })

  it('请求里要求流式返回', async () => {
    let body: Record<string, unknown> = {}
    const fetch: Fetch = async (url, init) => {
      body = JSON.parse(String(init?.body))
      return sse(['{}'])(url, init)
    }
    await chatJson('text', text, 's', 'u', fetch, undefined, () => {})
    expect(body.stream).toBe(true)
  })

  it('流式输出被截断 → truncated', async () => {
    expect(await codeOf(chatJson('text', text, 's', 'u', sse(['{"a":'], 'length'), undefined, () => {}))).toBe(
      'truncated',
    )
  })

  it('服务商不支持流式、直接返回整段时照常解析', async () => {
    const r = await chatJson(
      'text',
      text,
      's',
      'u',
      respond(200, { choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }),
      undefined,
      () => {},
    )
    expect(r).toEqual({ a: 1 })
  })
})
