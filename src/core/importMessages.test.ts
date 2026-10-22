import { describe, expect, it } from 'vitest'
import { importFailed, shortName } from './importMessages'

describe('shortName', () => {
  it('不长的文件名原样显示', () => {
    expect(shortName('商务礼仪.pdf')).toBe('商务礼仪.pdf')
  })

  it('太长时省略中间，保留开头和扩展名', () => {
    const long = '中国近代史 (蒋廷黻(撰)) (Z-Library).pdf'
    const s = shortName(long)
    expect(s.length).toBeLessThanOrEqual(24)
    expect(s).toContain('…')
    expect(s.startsWith('中国近代史')).toBe(true)
    expect(s.endsWith('.pdf')).toBe(true)
  })
})

describe('importFailed', () => {
  it('统一成「文件名」导入失败：原因。', () => {
    expect(importFailed('扫描件.pdf', '这是扫描版 PDF，里面没有可读的文字。可以截图后放入。')).toBe(
      '「扫描件.pdf」导入失败：这是扫描版 PDF，里面没有可读的文字。可以截图后放入。',
    )
  })
})
