import { describe, expect, it } from 'vitest'
import { meetingDocx, scannedPdf, twoPagePdf } from './docText.fixtures'
import { isScanned, LONG_TEXT_CHARS, mergeHardWraps, readDocx, readPdf } from './docText'

const fixture = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer

describe('readPdf', () => {
  it('取出文字，按页面宽度硬换行的句子合并成段', async () => {
    const r = await readPdf(fixture(twoPagePdf))
    expect(r.pages).toBe(2)
    expect(r.text).toBe('First page line one First page line two Second page line one Second page line two')
  })

  it('扫描版（页里没有文字）取出来是空的，并被认成扫描版', async () => {
    const r = await readPdf(fixture(scannedPdf))
    expect(r.pages).toBe(1)
    expect(r.text).toBe('')
    expect(isScanned(r)).toBe(true)
  })

  it('不是 PDF 的内容报错', async () => {
    await expect(readPdf(new TextEncoder().encode('随便写点字').buffer as ArrayBuffer)).rejects.toThrow()
  })
})

describe('readDocx', () => {
  it('取出标题、段落和表格里的文字', async () => {
    const r = await readDocx(fixture(meetingDocx))
    expect(r.text).toContain('会议纪要')
    expect(r.text).toContain('今天讨论了三件事。')
    expect(r.text).toContain('负责人')
    expect(r.text).toContain('小王')
  })

  it('不是 docx 的内容报错', async () => {
    await expect(readDocx(new TextEncoder().encode('不是压缩包').buffer as ArrayBuffer)).rejects.toThrow()
  })
})

describe('isScanned', () => {
  it('平均每页不到 20 个字就算没有文字', () => {
    expect(isScanned({ text: '1\n\n2\n\n3', pages: 3 })).toBe(true)
    expect(isScanned({ text: '这是一页有正文的文档，里面有一些完整的句子。', pages: 1 })).toBe(false)
  })
})

describe('LONG_TEXT_CHARS', () => {
  it('超过 8000 字提示内容较长（方案 US7）', () => {
    expect(LONG_TEXT_CHARS).toBe(8000)
  })
})

describe('mergeHardWraps', () => {
  it('中文：没写完的行接到下一行，句子结尾换段', () => {
    const t =
      '我的杨总啊，这责你负得了吗？你一头钻在技术里，‘红岸’可\n是与其他国防重点项目不同，它的复杂，是复杂在技术之外的。\n“你这倒是实话。”\n※※※\n降落时已是傍晚，叶文洁谢绝了搀扶，自己艰难\n地走下飞机。'
    expect(mergeHardWraps(t)).toBe(
      '我的杨总啊，这责你负得了吗？你一头钻在技术里，‘红岸’可是与其他国防重点项目不同，它的复杂，是复杂在技术之外的。\n“你这倒是实话。”\n※※※\n降落时已是傍晚，叶文洁谢绝了搀扶，自己艰难地走下飞机。',
    )
  })

  it('英文：接行时补一个空格', () => {
    expect(mergeHardWraps('This is a long line that wraps\nonto the next line and ends here.')).toBe(
      'This is a long line that wraps onto the next line and ends here.',
    )
  })

  it('很短的行（标题、页码）单独成段', () => {
    expect(mergeHardWraps('第一章\n这一章讲了很多事情，写得比较长一些，要换行才放得下\n接着写完。\n12')).toBe(
      '第一章\n这一章讲了很多事情，写得比较长一些，要换行才放得下接着写完。\n12',
    )
  })
})
