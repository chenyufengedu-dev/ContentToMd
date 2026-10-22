import { describe, expect, it } from 'vitest'
import { cleanTranscript, effectiveLength, SAMPLE_RATE, splitChunks, toWav, wavSeconds } from './audio'

describe('toWav', () => {
  it('生成 16kHz 单声道 16 位的 WAV 文件头和数据', async () => {
    const wav = toWav(new Float32Array([0, 1, -1, 2]))
    const v = new DataView(await wav.arrayBuffer())
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(v.buffer, o, n))
    expect(wav.size).toBe(44 + 4 * 2)
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1) // 声道数
    expect(v.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(v.getUint16(34, true)).toBe(16)
    // 超出 [-1, 1] 的采样被截断
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767])
  })
})

describe('splitChunks', () => {
  it('按 10 分钟切段，最后一段可以更短', () => {
    const tenMin = 600 * SAMPLE_RATE
    expect(splitChunks(new Float32Array(tenMin * 2 + 5)).map((c) => c.length)).toEqual([tenMin, tenMin, 5])
    expect(splitChunks(new Float32Array(100)).map((c) => c.length)).toEqual([100])
  })
})

describe('转写清理', () => {
  it('去掉 SenseVoice 的情绪和事件标记', () => {
    expect(cleanTranscript('🎼商务礼仪的三个重点分享给大家。😊第一个重点呢叫做摆正位置。😡')).toBe(
      '商务礼仪的三个重点分享给大家。第一个重点呢叫做摆正位置。',
    )
  })

  it('有效字数不算空白和标点', () => {
    expect(effectiveLength('嗯。。 ！ \n 啊？')).toBe(2)
    expect(effectiveLength('尊重上级是我们的天职')).toBe(10)
  })
})

describe('wavSeconds', () => {
  it('按 16kHz 单声道 16 位的 WAV 大小算出音频有多少秒', () => {
    expect(wavSeconds(toWav(new Float32Array(SAMPLE_RATE * 3)))).toBe(3)
    expect(wavSeconds(new Blob(['a']))).toBe(0)
  })
})
