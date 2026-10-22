import { describe, expect, it } from 'vitest'
import { isCondensed, lengthProblem, mapPool, MAX_CHARS, splitTextChunks } from './longText'

const para = (n: number, c = '字') => c.repeat(n - 1) + '。'

describe('lengthProblem', () => {
  it('要点提炼最多 8 万字，原文精修最多 2 万字，超过时说清楚怎么办', () => {
    expect(MAX_CHARS).toEqual({ 要点提炼: 80000, 原文精修: 20000, 视觉收藏: 80000 })
    expect(lengthProblem('要点提炼', 80000)).toBeNull()
    expect(lengthProblem('要点提炼', 80001)).toContain('8 万字')
    expect(lengthProblem('原文精修', 20000)).toBeNull()
    const m = lengthProblem('原文精修', 20001)
    expect(m).toContain('2 万字')
    expect(m).toContain('要点提炼')
  })
})

describe('splitTextChunks', () => {
  it('不到一块的整段不拆', () => {
    expect(splitTextChunks('段一\n段二', 3000)).toEqual(['段一\n段二'])
  })

  it('按段落攒到每块约 3000 字，段落不拆开，拼回去和原来一样', () => {
    const text = [para(1000), para(1000), para(1000), para(1000)].join('\n')
    const chunks = splitTextChunks(text, 3000)
    expect(chunks.map((c) => c.length)).toEqual([2001, 2001])
    expect(chunks.join('\n')).toBe(text)
  })

  it('一整段特别长时在句子结尾拆，每块不超过目标长度，拼回去和原来一样', () => {
    const text = Array.from({ length: 70 }, () => para(100)).join('')
    const chunks = splitTextChunks(text, 3000)
    expect(chunks.length).toBe(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000)
    expect(chunks.join('')).toBe(text)
  })

  it('空内容没有块', () => {
    expect(splitTextChunks('  \n ', 3000)).toEqual([])
  })
})

describe('isCondensed', () => {
  it('精修的输出比原文短了四成以上，算 AI 悄悄改成了摘要', () => {
    expect(isCondensed(3000, 1799)).toBe(true)
    expect(isCondensed(3000, 1800)).toBe(false)
    expect(isCondensed(3000, 2900)).toBe(false)
  })
})

describe('mapPool', () => {
  it('同时最多跑 limit 个，结果按原来的顺序返回', async () => {
    let running = 0
    let peak = 0
    const r = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((ok) => setTimeout(ok, 5 * (8 - x)))
      running--
      return x * 10
    })
    expect(r).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(peak).toBe(3)
  })

  it('有一个失败就报错，后面没开始的不再开始', async () => {
    const started: number[] = []
    await expect(
      mapPool([1, 2, 3, 4, 5, 6], 2, async (x) => {
        started.push(x)
        await new Promise((ok) => setTimeout(ok, 5))
        if (x === 2) throw new Error('坏了')
        return x
      }),
    ).rejects.toThrow('坏了')
    expect(started.length).toBeLessThan(6)
  })
})
