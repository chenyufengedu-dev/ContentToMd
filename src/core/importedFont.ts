const loaded = new Map<string, Promise<FontFace>>()

export function loadImportedFont(file: { family: string; data: string }): Promise<FontFace> {
  const existing = loaded.get(file.family)
  if (existing) return existing
  const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))
  const task = new FontFace(file.family, bytes)
    .load()
    .then((face) => {
      document.fonts.add(face)
      return face
    })
    .catch((error: unknown) => {
      loaded.delete(file.family)
      throw error
    })
  loaded.set(file.family, task)
  return task
}
