import { describe, expect, it } from 'vitest'
import { estimateCost, formatYuan, hasPrice, keyId, summarize, type UsageRecord } from './cost'

// 北京时间 = UTC+8
const bj = (s: string) => new Date(`${s}+08:00`)

describe('estimateCost：用量 × 用户填的单价（元 / 百万 tokens）', () => {
  const usage = {
    prompt_tokens: 3000,
    completion_tokens: 1000,
    prompt_cache_hit_tokens: 1000,
    prompt_cache_miss_tokens: 2000,
  }
  it('命中、未命中、输出分开算', () => {
    // 1000×0.02 + 2000×1 + 1000×4 = 6020 / 1e6
    expect(estimateCost({ input: 1, cachedInput: 0.02, output: 4 }, usage)).toBeCloseTo(0.00602, 8)
  })
  it('没填缓存命中价：命中的也按输入价算', () => {
    expect(estimateCost({ input: 1, output: 4 }, usage)).toBeCloseTo(0.007, 8)
  })
  it('OpenAI 风格的 cached_tokens 也认', () => {
    const u = { prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 400 } }
    expect(estimateCost({ input: 1, cachedInput: 0.1, output: 4 }, u)).toBeCloseTo((400 * 0.1 + 600) / 1e6, 10)
  })
  it('没填价格、只填了一半、服务没给用量：不知道，返回 null', () => {
    expect(estimateCost(undefined, usage)).toBeNull()
    expect(estimateCost({ input: 1 }, usage)).toBeNull()
    expect(estimateCost({ input: 1, output: 4 }, undefined)).toBeNull()
  })
  it('价格填 0（免费模型）：0 元', () => {
    expect(estimateCost({ input: 0, output: 0 }, usage)).toBe(0)
    expect(hasPrice({ input: 0, output: 0 })).toBe(true)
  })
})

describe('formatYuan', () => {
  it.each([
    [0, '0 元'],
    [0.003, '不到 1 分钱'],
    [0.0123, '约 0.01 元'],
    [1.236, '约 1.24 元'],
  ])('%s → %s', (y, s) => expect(formatYuan(y)).toBe(s))
})

describe('keyId', () => {
  it('同一把密钥得到同一个编号，不含密钥本身', async () => {
    const a = await keyId('sk-abcdef123456')
    expect(a).toBe(await keyId(' sk-abcdef123456 '))
    expect(a).not.toContain('abcdef')
    expect(a).toHaveLength(8)
    expect(a).not.toBe(await keyId('sk-other'))
  })
})

describe('summarize：按密钥算本月和累计', () => {
  const rec = (time: string, key: string, cost: number | null): UsageRecord => ({
    time: bj(time).toISOString(),
    service: 'text',
    model: 'deepseek-flash',
    keyId: key,
    cost,
  })
  it('只算这把密钥；本月按北京时间算；没算钱的单独计数', () => {
    const s = summarize(
      [
        rec('2026-09-30T23:00:00', 'k1', 1),
        rec('2026-10-01T01:00:00', 'k1', 0.5),
        rec('2026-10-21T10:00:00', 'k1', 0.25),
        rec('2026-10-21T10:00:00', 'k1', null),
        rec('2026-10-21T10:00:00', 'k2', 9),
      ],
      'k1',
      bj('2026-10-21T12:00:00'),
    )
    expect(s).toEqual({ month: 0.75, total: 1.75, calls: 4, unknown: 1 })
  })
})
