// 整理指令的拼装、AI 结果的校验、笔记 Markdown 的生成（方案第 9.7、10.3、10.4 节）

import { z } from 'zod'
import type { Domain } from './config'
import { OTHER_DOMAIN_ID } from './config'

export type Mode = '原文精修' | '要点提炼' | '视觉收藏'
export const MODES: Mode[] = ['要点提炼', '原文精修', '视觉收藏']
export type SourceType = '文字' | '图片' | '音频' | '视频' | '文档'

/** 自动预选（方案第 9.1 节）：音视频 → 要点提炼；只有图片 → 视觉收藏；其他 → 原文精修 */
export function preselectMode(type: SourceType): Mode {
  if (type === '音频' || type === '视频') return '要点提炼'
  if (type === '图片') return '视觉收藏'
  return '原文精修'
}

/** 指令文件：_通用.md + 每种整理方式一个 */
export type Prompts = Record<'_通用' | Mode, string>

export function buildSystemPrompt(prompts: Prompts, mode: Mode, domains: Domain[], existingTags: string[]): string {
  const domainList = domains.map((d) => `${d.id} ${d.name}`).join('，')
  // 已有标签只附最常用的一部分，避免指令过长
  const tags = existingTags.length ? existingTags.slice(0, 200).join('、') : '（还没有）'
  return prompts._通用.replace('{{领域列表}}', domainList).replace('{{已有标签}}', tags) + '\n\n' + prompts[mode]
}

/** 原文放进分隔标记里，防止原文中的文字被当作指令（方案第 9.7 节） */
export function buildUserMessage(sourceDesc: string, text: string): string {
  return `来源：${sourceDesc}\n\n<<<材料开始>>>\n${text}\n<<<材料结束>>>`
}

/** 去空白、去重、去空项，最多保留 max 个；不是字符串的项丢掉 */
const strList = (max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((v) =>
      [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim()))].filter(Boolean).slice(0, max),
    )

/**
 * AI 返回结构的校验（方案第 9.7 节）。title 和 body 必填，其余字段缺失或类型不对时给空值，
 * 不因为次要字段出错就整条重试
 */
const AiResultSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .transform((t) => t.slice(0, 30)),
  domain_id: z.coerce.number().catch(Number.NaN),
  tags: strList(8),
  keywords: strList(12),
  summary: z.string().trim().catch(''),
  body: z.string().trim().min(1),
})

/** 确认页编辑的笔记内容：AI 结果里的 domain_id 换成已校验的领域编号 */
export type NoteDraft = Omit<z.infer<typeof AiResultSchema>, 'domain_id'> & { domainId: number }

/** 校验 AI 返回的 JSON；必填字段缺失时返回 null，由调用方重试。domain_id 不在列表里时改为“其他” */
export function parseAiResult(raw: unknown, domains: Domain[]): { draft: NoteDraft; domainFallback: boolean } | null {
  const r = AiResultSchema.safeParse(raw)
  if (!r.success) return null
  const { domain_id, ...rest } = r.data
  const known = domains.some((d) => d.id === domain_id)
  return {
    draft: { ...rest, domainId: known ? domain_id : OTHER_DOMAIN_ID },
    domainFallback: !known,
  }
}

export interface NoteMeta {
  domain: string
  type: SourceType
  mode: Mode
  source: string
  platform: string
  author: string
  created: string // YYYY-MM-DD
  cover: string
}

/** YAML 里统一用 JSON 风格的双引号字符串，避免冒号、井号等特殊字符出错 */
const q = (s: string) => JSON.stringify(s)
const list = (xs: string[]) => `[${xs.map(q).join(', ')}]`

/** 拼成笔记（方案第 10.3 节） */
export function buildMarkdown(d: NoteDraft, m: NoteMeta): string {
  const fm = [
    '---',
    `title: ${q(d.title)}`,
    `domain: ${q(m.domain)}`,
    `type: ${m.type}`,
    `mode: ${m.mode}`,
    `tags: ${list(d.tags)}`,
    `keywords: ${list(d.keywords)}`,
    `source: ${q(m.source)}`,
    `platform: ${q(m.platform)}`,
    `author: ${q(m.author)}`,
    `created: ${m.created}`,
    `cover: ${q(m.cover)}`,
    'schema: 1',
    '---',
  ]
  const parts = [fm.join('\n')]
  if (d.summary) parts.push(`> [!summary] 这条讲什么\n> ${d.summary.replace(/\n+/g, ' ')}`)
  // 来源说明由程序加，不交给 AI
  if (m.type === '音频' || m.type === '视频') parts.push('> [!note] 内容来自语音转写，没有分析画面。')
  if (m.type === '图片') parts.push('> [!note] 仅根据截图整理。')
  parts.push(d.body)
  return parts.join('\n\n') + '\n'
}

/** 文件名：非法字符换成“-”，截短到 60 字以内（方案第 8 节） */
export function safeFileTitle(title: string): string {
  const t = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
  return t || '未命名'
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
