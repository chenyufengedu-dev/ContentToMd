// 放入文件时给用户看的提示：统一写成「文件名」导入失败：原因。句子都带句号

/** 文件名太长时省略中间，保留开头和扩展名，最多 max 个字（完整的名字放在鼠标悬停提示里） */
export function shortName(name: string, max = 24): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : ''
  return `${name.slice(0, max - 1 - ext.length)}…${ext}`
}

export const importFailed = (name: string, reason: string) => `「${shortName(name)}」导入失败：${reason}`
