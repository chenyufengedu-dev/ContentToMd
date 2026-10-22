// 收藏库页（F21）：外壳读出的笔记列表 → 按领域、标签筛选，搜索，排序，计数；卡片上显示的文字
import { z } from 'zod'

const NoteSchema = z.object({
  path: z.string(), // 相对存放文件夹：领域/文件名.md
  title: z.string(),
  domain: z.string(),
  created: z.string().catch(''),
  tags: z.array(z.string()).catch([]),
  keywords: z.array(z.string()).catch([]),
  cover: z.string().catch(''), // 相对存放文件夹：附件/年-月/图.png；没有图片时为空
  body: z.string().catch(''),
})
const NoteListSchema = z.object({
  notes: z.array(NoteSchema),
  failed: z.array(z.string()).catch([]),
})

export type LibraryNote = z.infer<typeof NoteSchema>
export type NoteList = z.infer<typeof NoteListSchema>

/** 外壳 list_notes 的结果 */
export function parseNoteList(raw: unknown): NoteList {
  return NoteListSchema.parse(raw)
}

export interface LibraryFilter {
  /** null 是“全部” */
  domain: string | null
  /** 要同时带有这些标签 */
  tags: string[]
  query: string
}

/** 筛选和搜索后的笔记，收藏日期从新到旧（同一天按路径，顺序稳定，卡片序号不乱跳） */
export function filterNotes(notes: LibraryNote[], f: LibraryFilter): LibraryNote[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean)
  return notes
    .filter((n) => f.domain === null || n.domain === f.domain)
    .filter((n) => f.tags.every((t) => n.tags.includes(t)))
    .filter((n) => {
      if (!words.length) return true
      // 正文里包括“图片中的文字”（方案 US10）
      const text = [n.title, ...n.keywords, n.body].join('\n').toLowerCase()
      return words.every((w) => text.includes(w))
    })
    .sort((a, b) => b.created.localeCompare(a.created) || a.path.localeCompare(b.path))
}

export interface Count {
  name: string
  count: number
}

/** 左边领域列表：设置里的领域按设置的顺序（没有笔记也列出），设置里没有的文件夹排在后面 */
export function domainCounts(notes: LibraryNote[], domains: string[]): Count[] {
  const count = new Map<string, number>(domains.map((d) => [d, 0]))
  for (const n of notes) count.set(n.domain, (count.get(n.domain) ?? 0) + 1)
  return [...count].map(([name, c]) => ({ name, count: c }))
}

/** 标签按用的次数从多到少，一样多的按名字 */
export function tagCounts(notes: LibraryNote[]): Count[] {
  const count = new Map<string, number>()
  for (const n of notes) for (const t of n.tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count]
    .map(([name, c]) => ({ name, count: c }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** 卡片背面的正文：去掉提示框标题行、图片、标题和列表符号，只留读得懂的文字 */
export function previewLines(body: string, max: number): string[] {
  const lines: string[] = []
  for (const raw of body.split('\n')) {
    if (/^\s*>\s*\[!/.test(raw)) continue // 提示框的标题行，比如“> [!summary] 这条讲什么”
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(raw)) continue // 单独一行的图片
    const line = raw
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
      .trim()
    if (line) lines.push(line)
    if (lines.length >= max) break
  }
  return lines
}

/**
 * 笔记里写的图片路径（相对笔记所在文件夹，比如 ../附件/2026-10/a.png）换成相对存放文件夹的路径，交给外壳读；
 * 跳出存放文件夹的不认，返回空
 */
export function resolveAttachment(notePath: string, rel: string): string {
  const parts = notePath.split('/').slice(0, -1)
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '..') {
      if (!parts.length) return ''
      parts.pop()
    } else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** 封面图相对存放文件夹的路径；没有封面时为空 */
export const coverPath = (n: LibraryNote): string => (n.cover ? resolveAttachment(n.path, n.cover) : '')

/** 卡片上的日期：今年的写“10-18”，往年的写全 */
export function cardDate(created: string, thisYear = new Date().getFullYear()): string {
  if (!created) return ''
  return created.startsWith(`${thisYear}-`) ? created.slice(5) : created
}
