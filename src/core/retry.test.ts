import { describe, expect, it } from 'vitest'
import { AppError } from './errors'
import { RATE_LIMIT_WAITS, retryOnRateLimit } from './retry'

const limited = () => new AppError('rate_limit', '请求太频繁，请稍后重试')
const noSleep = async () => {}

describe('retryOnRateLimit（方案第 8 节：429 自动重试最多 2 次，间隔加长）', () => {
  it('两次 429 后成功：一共调 3 次，每次等之前告诉界面要等几秒', async () => {
    let n = 0
    const waits: number[] = []
    const r = await retryOnRateLimit(
      async () => {
        if (++n < 3) throw limited()
        return 'ok'
      },
      { onWait: (s) => waits.push(s), sleep: noSleep },
    )
    expect([r, n]).toEqual(['ok', 3])
    expect(waits).toEqual(RATE_LIMIT_WAITS)
    expect(RATE_LIMIT_WAITS[1]).toBeGreaterThan(RATE_LIMIT_WAITS[0])
  })

  it('重试 2 次仍然 429：停下，抛出 rate_limit', async () => {
    let n = 0
    const p = retryOnRateLimit(
      async () => {
        n++
        throw limited()
      },
      { sleep: noSleep },
    )
    await expect(p).rejects.toMatchObject({ code: 'rate_limit' })
    expect(n).toBe(3)
  })

  it('别的错误不重试', async () => {
    let n = 0
    const p = retryOnRateLimit(
      async () => {
        n++
        throw new AppError('auth', '密钥无效')
      },
      { sleep: noSleep },
    )
    await expect(p).rejects.toMatchObject({ code: 'auth' })
    expect(n).toBe(1)
  })

  it('等待时点了取消：不再重试，抛出 cancelled', async () => {
    const ctrl = new AbortController()
    let n = 0
    const p = retryOnRateLimit(
      async () => {
        n++
        throw limited()
      },
      { cancel: ctrl.signal, sleep: async () => ctrl.abort() },
    )
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    expect(n).toBe(1)
  })
})
