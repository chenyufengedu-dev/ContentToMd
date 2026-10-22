// F15、F16：读取 PDF 和 Word（.docx）里的文字，之后和 MD / TXT 一样整理（方案第 5 节、US7）。
// 两个库都只在放入这类文件时才加载，平时不占内存。PDF 用带兼容处理的 legacy 版：新版要求较新的浏览器内核，旧一点的 WebView2 会读不出

export interface DocText {
  text: string
  /** PDF 的页数；Word 没有 */
  pages?: number
}

/** 超过这个字数提示“内容较长，整理可能需要更久、花费更多”（US7） */
export const LONG_TEXT_CHARS = 8000

/** PDF 的后台读取程序放在哪里由界面告诉我们（打包后是一个单独的文件）；不设置时库自己找 */
let pdfWorkerSrc = ''
export const setPdfWorker = (url: string) => (pdfWorkerSrc = url)

/** 取出文字，按页面宽度硬换行的句子合并成段；没有文字的页（比如扫描页）是空的 */
export async function readPdf(buf: ArrayBuffer): Promise<DocText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (pdfWorkerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''))
    }
    return { text: mergeHardWraps(pages.join('\n')), pages: doc.numPages }
  } finally {
    await task.destroy()
  }
}

/** 取出标题、段落和表格里的文字（不要图片和样式）。用浏览器版：能直接读内存里的文件内容 */
export async function readDocx(buf: ArrayBuffer): Promise<DocText> {
  const m = await import('mammoth/mammoth.browser')
  const r = await (m.default ?? m).extractRawText({ arrayBuffer: buf })
  return { text: r.value.trim() }
}

/** 扫描版 PDF：平均每页不到 20 个字，当作里面没有文字（方案 US7） */
export function isScanned(d: DocText): boolean {
  const chars = d.text.replace(/\s/g, '').length
  return chars / Math.max(d.pages ?? 1, 1) < 20
}

const SENTENCE_END = /[。！？”」…!?.:：;；)）"]$/
/** 不是可打印的 ASCII 字符（中文、全角标点等） */
const NON_ASCII = /[^ -~]/
const joinLines = (a: string, b: string) => (NON_ASCII.test(a.slice(-1)) || NON_ASCII.test(b[0]) ? '' : ' ')

/**
 * PDF 里的文字是按页面宽度硬换行的，句子被切成一行一行。把没写完的行接到下一行，
 * 句子结尾或很短的行（标题、页码）单独成段；中文直接接，英文接行时补一个空格
 */
export function mergeHardWraps(text: string): string {
  const paras: string[] = []
  let cur = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      if (cur) paras.push(cur)
      cur = ''
      continue
    }
    cur = cur ? cur + joinLines(cur, line) + line : line
    if (SENTENCE_END.test(line) || line.length < 12) {
      paras.push(cur)
      cur = ''
    }
  }
  if (cur) paras.push(cur)
  return paras.join('\n')
}
