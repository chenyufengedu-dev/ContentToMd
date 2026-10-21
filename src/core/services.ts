// 服务接入层：OpenAI 兼容接口。fetch 由外壳注入，这里不依赖 Tauri（方案第 11、12.1 节）

import type { ServiceConfig, ServiceKind } from './config'
import { SERVICE_LABELS, checkBaseUrl } from './config'
import { toWav } from './audio'
import { AppError } from './errors'
import type { Usage } from './cost'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** 超时：文字和图片 120 秒，转写 300 秒（方案第 8 节） */
export const TIMEOUT_MS: Record<ServiceKind, number> = { text: 120_000, vision: 120_000, asr: 300_000 }

const join = (base: string, path: string) => base.replace(/\/+$/, '') + path

async function request(
  kind: ServiceKind,
  fetch: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS[kind],
  cancel?: AbortSignal,
) {
  const name = SERVICE_LABELS[kind]
  const insecure = checkBaseUrl(url)
  if (insecure) throw new AppError('insecure_url', insecure, url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onCancel = () => ctrl.abort()
  cancel?.addEventListener('abort', onCancel)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (cancel?.aborted) throw new AppError('cancelled', '已取消')
    const timedOut = ctrl.signal.aborted
    throw timedOut
      ? new AppError('timeout', '服务响应超时，请检查网络后重试', String(e))
      : new AppError('network', '网络连接失败，请检查网络和接口地址后重试', String(e))
  } finally {
    clearTimeout(timer)
    cancel?.removeEventListener('abort', onCancel)
  }
  if (res.ok) return res
  const body = await res.text().catch(() => '')
  const detail = `HTTP ${res.status} ${body.slice(0, 500)}`
  if (res.status === 401 || res.status === 403)
    throw new AppError('auth', `${name}服务的密钥无效，请到设置中检查`, detail)
  if (res.status === 402 || /balance|余额|insufficient|quota/i.test(body))
    throw new AppError('balance', `${name}账户余额不足，请充值后重试`, detail)
  if (res.status === 404 || (res.status === 400 && /model/i.test(body)))
    throw new AppError('not_found', `找不到${name}的接口或模型，请检查接口地址和模型名`, detail)
  if (res.status === 429) throw new AppError('rate_limit', '请求太频繁，请稍后重试', detail)
  throw new AppError('unavailable', `${name}暂时不可用，请稍后重试`, detail)
}

/** 1×1 白色 PNG，用来测试看图接口 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

/** 测试连接：用最小的请求确认地址、模型和密钥都能用。测试只等 30 秒 */
export async function testService(kind: ServiceKind, s: ServiceConfig, fetch: Fetch): Promise<void> {
  const auth = { Authorization: `Bearer ${s.apiKey.trim()}` }
  if (kind === 'asr') {
    const form = new FormData()
    form.append('model', s.model.trim())
    form.append('file', toWav(new Float32Array(8000)), 'test.wav') // 0.5 秒静音
    await request(
      kind,
      fetch,
      join(s.baseUrl, '/audio/transcriptions'),
      { method: 'POST', headers: auth, body: form },
      30_000,
    )
    return
  }
  const content =
    kind === 'vision'
      ? [
          { type: 'text', text: '回复 OK' },
          { type: 'image_url', image_url: { url: TINY_PNG } },
        ]
      : '回复 OK'
  const res = await request(
    kind,
    fetch,
    join(s.baseUrl, '/chat/completions'),
    {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.model.trim(), max_tokens: 5, messages: [{ role: 'user', content }] }),
    },
    30_000,
  )
  const data = await res.json().catch(() => null)
  if (!data?.choices)
    throw new AppError('bad_response', '服务返回的结果格式不对，请检查接口地址', JSON.stringify(data).slice(0, 500))
}

/** 语音转写：返回原始文字 */
export async function transcribe(s: ServiceConfig, wav: Blob, fetch: Fetch, cancel?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('model', s.model.trim())
  form.append('file', wav, 'audio.wav')
  const res = await request(
    'asr',
    fetch,
    join(s.baseUrl, '/audio/transcriptions'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey.trim()}` },
      body: form,
    },
    undefined,
    cancel,
  )
  const data = await res.json().catch(() => null)
  if (typeof data?.text !== 'string')
    throw new AppError('bad_response', '转写服务返回的结果格式不对，请点击重试', JSON.stringify(data).slice(0, 500))
  return data.text
}

/**
 * 文字整理 / 看图理解：要求返回 JSON 对象，返回解析后的对象。
 * 传了 onText 时用流式请求，边生成边把已生成的内容交给 onText（处理中的预览框用，方案第 11 节）；
 * 服务商不支持流式、直接返回整段时照常解析
 */
export async function chatJson(
  kind: 'text' | 'vision',
  s: ServiceConfig,
  system: string,
  user: unknown,
  fetch: Fetch,
  cancel?: AbortSignal,
  onText?: (soFar: string) => void,
  /** 这次调用用了多少 tokens（F14 费用记录）；服务没返回用量时不调用 */
  onUsage?: (u: Usage) => void,
): Promise<unknown> {
  const res = await request(
    kind,
    fetch,
    join(s.baseUrl, '/chat/completions'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: s.model.trim(),
        response_format: { type: 'json_object' },
        ...(onText ? { stream: true, stream_options: { include_usage: true } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    undefined,
    cancel,
  )
  let content: unknown
  let finish: unknown
  let usage: Usage | undefined
  if (onText && res.body && /event-stream/i.test(res.headers.get('Content-Type') ?? '')) {
    ;({ content, finish, usage } = await readStream(res.body, onText, cancel))
  } else {
    const data = await res.json().catch(() => null)
    content = data?.choices?.[0]?.message?.content
    finish = data?.choices?.[0]?.finish_reason
    usage = data?.usage
  }
  if (usage) onUsage?.(usage)
  if (finish === 'length') throw new AppError('truncated', '内容太长，AI 的输出被截断了', 'finish_reason=length')
  try {
    return JSON.parse(String(content))
  } catch {
    throw new AppError('format', 'AI 返回的结果格式异常，请点击重试', String(content).slice(0, 500))
  }
}

/** 读流式返回（SSE）：每行 data: {...}，内容在 choices[0].delta.content，以 data: [DONE] 结束 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onText: (soFar: string) => void,
  cancel?: AbortSignal,
): Promise<{ content: string; finish: unknown; usage?: Usage }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let finish: unknown
  let usage: Usage | undefined
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? '' // 最后一行可能还没收全
      let changed = false
      for (const line of lines) {
        const m = /^data:\s*(.*)$/.exec(line.trim())
        if (!m || m[1] === '[DONE]') continue
        const chunk = JSON.parse(m[1])
        if (chunk?.usage) usage = chunk.usage // 要了用量时，最后一块单独带 usage
        const choice = chunk?.choices?.[0]
        if (typeof choice?.delta?.content === 'string') {
          content += choice.delta.content
          changed = true
        }
        if (choice?.finish_reason) finish = choice.finish_reason
      }
      if (changed) onText(content)
    }
  } catch (e) {
    if (cancel?.aborted) throw new AppError('cancelled', '已取消')
    if (e instanceof SyntaxError) throw new AppError('bad_response', '服务返回的结果格式不对，请点击重试', String(e))
    throw new AppError('network', '网络连接中断，请检查网络后重试', String(e))
  }
  return { content, finish, usage }
}
