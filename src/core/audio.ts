// 从音视频里取出声音：用 WebView2 自带的解码器，转成 16kHz 单声道（方案第 12.2 节，S0 已验证）

export const SAMPLE_RATE = 16000
/** 超过服务商的大小限制时按约 10 分钟切段（方案第 12.2 节） */
const CHUNK_SECONDS = 600

import { AppError } from './errors'

/** 解码并重采样；解不开时抛 code 为 decode 的 AppError */
export async function decodeTo16kMono(data: ArrayBuffer): Promise<{ samples: Float32Array; duration: number }> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(data)
  } catch {
    throw new AppError('decode', '无法读取声音，请转为 MP4 或 MP3 后重试。')
  } finally {
    void ctx.close()
  }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return { samples: rendered.getChannelData(0), duration: decoded.duration }
}

/** 16 位 PCM WAV */
/** toWav 生成的 WAV（16kHz 单声道 16 位，文件头 44 字节）有多少秒；转写按音频时长计费时用 */
export const wavSeconds = (wav: Blob): number => Math.max(0, (wav.size - 44) / (SAMPLE_RATE * 2))

export function toWav(samples: Float32Array): Blob {
  const v = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, SAMPLE_RATE, true)
  v.setUint32(28, SAMPLE_RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return new Blob([v], { type: 'audio/wav' })
}

/** 切成不超过 10 分钟的段 */
export function splitChunks(samples: Float32Array): Float32Array[] {
  const size = CHUNK_SECONDS * SAMPLE_RATE
  const out: Float32Array[] = []
  for (let i = 0; i < samples.length; i += size) out.push(samples.subarray(i, i + size))
  return out
}

/** SenseVoice 会插入 🎼😊😡 等情绪、事件标记，由程序去掉，不交给 AI */
export function cleanTranscript(text: string): string {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()
}

/** 有效字数：去掉空白和标点，用来判断“没有识别到语音”（少于 20 字，方案第 8 节） */
export function effectiveLength(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length
}
