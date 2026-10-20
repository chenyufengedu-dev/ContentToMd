// 服务接入层：OpenAI 兼容接口。fetch 由外壳注入，这里不依赖 Tauri（方案第 11、12.1 节）

import type { ServiceConfig, ServiceKind } from './config'
import { SERVICE_LABELS, checkBaseUrl } from './config'
import { toWav } from './audio'
import { AppError } from './errors'

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

/** 文字整理 / 看图理解：要求返回 JSON 对象，返回解析后的对象 */
export async function chatJson(
  kind: 'text' | 'vision',
  s: ServiceConfig,
  system: string,
  user: unknown,
  fetch: Fetch,
  cancel?: AbortSignal,
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
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    undefined,
    cancel,
  )
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (data?.choices?.[0]?.finish_reason === 'length')
    throw new AppError('truncated', '内容太长，AI 的输出被截断了', 'finish_reason=length')
  try {
    return JSON.parse(content)
  } catch {
    throw new AppError('format', 'AI 返回的结果格式异常，请点击重试', String(content).slice(0, 500))
  }
}
