// 请求太频繁（429）时自动重试（方案第 8 节）：最多 2 次，间隔加长；等的时候告诉界面还要等几秒，可以取消

import { AppError, isAppError } from './errors'

/** 两次重试前各等几秒 */
export const RATE_LIMIT_WAITS = [5, 15]

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  opts: { onWait?: (seconds: number) => void; cancel?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = opts.sleep ?? realSleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isAppError(e, 'rate_limit') || attempt >= RATE_LIMIT_WAITS.length) throw e
      const seconds = RATE_LIMIT_WAITS[attempt]
      opts.onWait?.(seconds)
      await sleep(seconds * 1000)
      if (opts.cancel?.aborted) throw new AppError('cancelled', '已取消')
    }
  }
}
