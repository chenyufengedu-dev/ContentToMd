import { describe, expect, it } from 'vitest'
import { decodeText } from './textFile'

const gbk = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16))).buffer
const utf8 = (s: string) => new TextEncoder().encode(s).buffer

describe('decodeText', () => {
  it('UTF-8', () => {
    expect(decodeText(utf8('会议记录：决定下周上线'))).toEqual({ text: '会议记录：决定下周上线', encoding: 'UTF-8' })
  })
  it('UTF-8 带 BOM：去掉 BOM', () => {
    const b = new Uint8Array([0xef, 0xbb, 0xbf, ...new Uint8Array(utf8('你好'))])
    expect(decodeText(b.buffer)).toEqual({ text: '你好', encoding: 'UTF-8' })
  })
  it('GBK（“会议记录”）', () => {
    expect(decodeText(gbk('BBE1D2E9BCC7C2BC'))).toEqual({ text: '会议记录', encoding: 'GBK' })
  })
  it('UTF-16 LE 带 BOM', () => {
    const b = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])
    expect(decodeText(b.buffer)).toEqual({ text: '你好', encoding: 'UTF-16' })
  })
  it('二进制乱码：认不出', () => {
    const b = new Uint8Array(200).map((_, i) => (i * 37 + 129) % 256)
    expect(decodeText(b.buffer)).toBeNull()
  })
})
