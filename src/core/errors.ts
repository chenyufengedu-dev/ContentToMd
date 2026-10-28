// 统一的错误类：按 code 判断，不按提示文字判断（《代码规范》第 3 节）

export type ErrorCode =
  | 'insecure_url' // 接口地址不是 https
  | 'network' // 断网、连不上
  | 'timeout' // 服务响应超时
  | 'auth' // 密钥无效（401 / 403）
  | 'balance' // 余额不足
  | 'not_found' // 接口地址或模型名不对
  | 'rate_limit' // 请求太频繁（429）
  | 'unavailable' // 服务的其他错误
  | 'bad_response' // 服务返回的结构不对
  | 'truncated' // AI 输出被截断
  | 'format' // AI 返回的不是合法 JSON，或缺少必填字段；自动重试 1 次
  | 'cancelled' // 用户点了取消
  | 'decode' // 音视频解不出声音
  | 'no_speech' // 没有识别到语音
  | 'too_long' // 文字太长，这种整理方式装不下

/** message 是给用户看的大白话，detail 可通过“复制错误信息”提供给作者。 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly detail = '',
  ) {
    super(message)
  }
}

export const isAppError = (e: unknown, code?: ErrorCode): e is AppError =>
  e instanceof AppError && (code === undefined || e.code === code)

/** 把任何错误转成给用户看的一句话 + 详细信息 */
export function describeError(e: unknown, provider?: string): { code?: ErrorCode; message: string; detail?: string } {
  if (e instanceof AppError) {
    const message = e.code === 'balance' && provider ? `${provider} 账户余额不足，请先充值。` : e.message
    return { code: e.code, message, detail: e.detail || undefined }
  }
  return { message: '操作失败，请重试。', detail: e instanceof Error ? e.message : String(e) }
}
