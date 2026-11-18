const loaded = new Map<string, Promise<FontFace>>()

// FontFace takes one sfnt. Extract the first face of a collection, including
// copies of shared tables whose offsets are relative to the original TTC.
export function fontFaceBytes(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (input.getUint32(0) !== 0x74746366) return bytes // ttcf
  const invalid = () => new Error('无法读取字体集合。')
  if (input.getUint32(8) === 0) throw invalid()
  const face = input.getUint32(12)
  const count = input.getUint16(face + 4)
  const directorySize = 12 + count * 16
  if (!count || face + directorySize > bytes.length) throw invalid()

  let size = directorySize
  const tables = Array.from({ length: count }, (_, i) => {
    const record = 12 + i * 16
    const start = input.getUint32(face + record + 8)
    const length = input.getUint32(face + record + 12)
    if (start + length > bytes.length) throw invalid()
    const outputOffset = size
    size += Math.ceil(length / 4) * 4
    if (size > 25 * 1024 * 1024) throw invalid()
    return { record, start, length, outputOffset }
  })
  const result = new Uint8Array(size)
  const output = new DataView(result.buffer)
  result.set(bytes.subarray(face, face + directorySize))
  let adjustment: number | undefined
  for (const { record, start, length, outputOffset } of tables) {
    result.set(bytes.subarray(start, start + length), outputOffset)
    output.setUint32(record + 8, outputOffset)
    if (length >= 12 && output.getUint32(record) === 0x68656164) adjustment = outputOffset + 8 // head
  }
  if (adjustment !== undefined) {
    output.setUint32(adjustment, 0)
    let checksum = 0
    for (let i = 0; i < size; i += 4) checksum = (checksum + output.getUint32(i)) >>> 0
    output.setUint32(adjustment, (0xb1b0afba - checksum) >>> 0)
  }
  return result
}

export async function fontFileId(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

type FontSource = { fileId: string } | { data: string }

export function loadImportedFont(
  file: { family: string } & FontSource,
  read: (id: string) => Promise<ArrayBuffer>,
  staged?: Uint8Array<ArrayBuffer>,
): Promise<FontFace> {
  const existing = loaded.get(file.family)
  if (existing) return existing
  const task = (async () => {
    const bytes =
      staged ??
      ('fileId' in file
        ? new Uint8Array(await read(file.fileId))
        : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0)))
    const face = await new FontFace(file.family, fontFaceBytes(bytes)).load()
    document.fonts.add(face)
    return face
  })().catch((error: unknown) => {
    loaded.delete(file.family)
    throw error
  })
  loaded.set(file.family, task)
  return task
}
