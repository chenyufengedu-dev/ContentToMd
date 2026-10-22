// 文件类型图标要认的几种类型（FileTypeIcon.vue 用）
export type FileKind = 'md' | 'txt' | 'pdf' | 'docx' | 'audio' | 'video' | 'image'

/** 由文件名认出文档类型；认不出的按 txt */
export function kindOfName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'pdf' || ext === 'docx' ? ext : 'txt'
}
