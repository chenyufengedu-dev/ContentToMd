// F07：读取 MD / TXT，自动识别编码（方案第 5 节 F07、第 8 节）。
// 不加依赖：先看 BOM，再按 UTF-8 严格解码，不行再按 GBK（GB18030）解；GBK 几乎什么字节都能解开，解出来的字大多是常用字才算认出来

export interface DecodedText {
  text: string
  encoding: 'UTF-8' | 'UTF-16' | 'GBK'
}

/** 认不出（像乱码或二进制）时返回 null，界面提示“文件编码无法识别，请另存为 UTF-8 后重试” */
export function decodeText(buf: ArrayBuffer): DecodedText | null {
  const b = new Uint8Array(buf)
  if (b[0] === 0xff && b[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16' }
  if (b[0] === 0xfe && b[1] === 0xff)
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16' }
  try {
    // 能按 UTF-8 严格解开就是 UTF-8（乱码几乎不可能恰好合法）；TextDecoder 默认会去掉 BOM
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' }
  } catch {
    // 不是合法的 UTF-8，往下试 GBK
  }
  try {
    return check(new TextDecoder('gb18030', { fatal: true }).decode(b), 'GBK')
  } catch {
    return null
  }
}

/** 常用字：可打印的 ASCII、空白、汉字、标点和符号（全角的也算） */
const COMMON = /[ -~\s\p{Script=Han}\p{P}\p{S}]/u

function check(text: string, encoding: 'GBK'): DecodedText | null {
  const chars = [...text]
  if (!chars.length) return { text, encoding }
  const common = chars.filter((c) => COMMON.test(c)).length
  return common / chars.length >= 0.9 ? { text, encoding } : null
}
