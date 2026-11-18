import { expect, it } from 'vitest'
import { fontFaceBytes } from './importedFont'

it('从 TTC 容器提取首个字形，保留表内容并改写偏移', () => {
  const bytes = new Uint8Array(52)
  const ttc = new DataView(bytes.buffer)
  ttc.setUint32(0, 0x74746366)
  ttc.setUint32(4, 0x10000)
  ttc.setUint32(8, 1)
  ttc.setUint32(12, 16)
  ttc.setUint32(16, 0x10000)
  ttc.setUint16(20, 1)
  ttc.setUint32(28, 0x6e616d65)
  ttc.setUint32(36, 48)
  ttc.setUint32(40, 4)
  ttc.setUint32(48, 0x12345678)
  const output = fontFaceBytes(bytes)
  const font = new DataView(output.buffer)
  expect(font.getUint32(0)).toBe(0x10000)
  expect(font.getUint32(20)).toBe(28)
  expect(font.getUint32(28)).toBe(0x12345678)
})
