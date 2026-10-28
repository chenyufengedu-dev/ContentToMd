// 整理指令的拼装、AI 结果的校验、笔记 Markdown 的生成（方案第 9.7、10.3、10.4 节）

import { z } from 'zod'
import type { Domain } from './config'
import { OTHER_DOMAIN_ID, checkDomainName } from './config'
import domainSuggestion from '../prompts/_领域建议.md?raw'

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
  const common = prompts._通用.includes('suggested_domain')
    ? prompts._通用
    : `${prompts._通用}\n${domainSuggestion.trim()}`
  return common.replace('{{领域列表}}', domainList).replace('{{已有标签}}', tags) + '\n\n' + prompts[mode]
}

/**
 * 原文放进分隔标记里，防止原文中的文字被当作指令（方案第 9.7 节）。
 * 分享文字（F02，帮 AI 认专有名词）和本次要求（F04，优先于默认规则，见 _通用.md）是用户自己写的，放在标记外面；空的不写
 */
export function buildUserMessage(
  sourceDesc: string,
  text: string,
  extra: { shareText?: string; request?: string } = {},
): string {
  const lines = [`来源：${sourceDesc}`]
  if (extra.shareText?.trim()) lines.push(`分享文字：${extra.shareText.trim()}`)
  if (extra.request?.trim()) lines.push(`本次要求：${extra.request.trim()}`)
  return `${lines.join('\n')}\n\n<<<材料开始>>>\n${text}\n<<<材料结束>>>`
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
  suggested_domain: z.string().trim().min(2).max(6).optional().catch(undefined),
  tags: strList(8),
  keywords: strList(12),
  summary: z.string().trim().catch(''),
  body: z.string().trim().min(1),
  image_captions: strList(9),
  /** 每张图的主体区域 [x, y, 宽, 高]（比例），由裁剪（image.ts）逐个校验，这里只要求是数组 */
  image_regions: z.array(z.unknown()).catch([]),
})

/** 用户编辑内容只校验类型，不套用AI输出的裁剪、去重或去空白，恢复时保留输入。 */
export const NoteDraftSchema = z.object({
  title: z.string(),
  domainId: z.number(),
  suggestedDomain: z.string().optional(),
  tags: z.array(z.string()),
  keywords: z.array(z.string()),
  summary: z.string(),
  body: z.string(),
  image_captions: z.array(z.string()),
})
export type NoteDraft = z.infer<typeof NoteDraftSchema>

/** 校验 AI 返回的 JSON；必填字段缺失时返回 null，由调用方重试。domain_id 不在列表里时改为“其他” */
export function parseAiResult(
  raw: unknown,
  domains: Domain[],
): { draft: NoteDraft; domainFallback: boolean; imageRegions: unknown[] } | null {
  const r = AiResultSchema.safeParse(raw)
  if (!r.success) return null
  const { domain_id, image_regions, suggested_domain, ...rest } = r.data
  const known = domains.some((d) => d.id === domain_id)
  const domainId = known ? domain_id : OTHER_DOMAIN_ID
  const suggestion =
    domainId === OTHER_DOMAIN_ID && suggested_domain && !checkDomainName(suggested_domain, domains)
      ? suggested_domain
      : undefined
  return {
    draft: { ...rest, domainId, ...(suggestion ? { suggestedDomain: suggestion } : {}) },
    domainFallback: !known,
    imageRegions: image_regions,
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
  /** 打开已有笔记再保存时，原来属性里别的程序加的行（比如 Obsidian 的 aliases），原样带回去 */
  extra?: string
}

/**
 * 处理中的预览框用：从生成到一半的 JSON 里取出标题、摘要、正文的文字（最后一段可能还没写完），
 * 去掉 JSON 和 Markdown 的符号，只留一行行普通文字。不用于保存，保存用 parseAiResult
 */
export function previewText(raw: string): string {
  const out: string[] = []
  for (const m of raw.matchAll(/"(title|summary|body)"\s*:\s*"((?:[^"\\]|\\.)*)/g)) {
    const text = m[2]
      .replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? ' ' : c))
      .split('\n')
      .map((l) =>
        l
          .replace(/^[\s>#*-]+/, '')
          .replace(/\[![\w-]+\]-?\s*/g, '')
          .replace(/\*\*/g, '')
          .trim(),
      )
      .filter(Boolean)
    out.push(...text)
  }
  return out.join('\n')
}

/** YAML 里统一用 JSON 风格的双引号字符串，避免冒号、井号等特殊字符出错 */
const q = (s: string) => JSON.stringify(s)
const list = (xs: string[]) => `[${xs.map(q).join(', ')}]`

/** 笔记里的一张图：path 是相对于笔记文件的位置，比如 ../附件/2026-10/xxx-1.png */
export interface NoteImage {
  path: string
  caption: string
  /** 正文中的显示宽度；不改变附件或封面。 */
  width?: number
}

/** 保留 Markdown 图片链接，显示宽度使用 Obsidian 的 |宽度 写法；路径有空格或括号时用尖括号包起来。 */
const imageLine = (i: NoteImage) => {
  const alt = i.caption.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  return `![${alt}${i.width ? `|${Math.round(i.width)}` : ''}](${/[\s()]/.test(i.path) ? `<${i.path}>` : i.path})`
}

/** 拼成笔记（方案第 10.3 节）。图片放在正文前面，第一张也是封面（由调用方填 meta.cover） */
export function buildMarkdown(d: NoteDraft, m: NoteMeta, images: NoteImage[] = []): string {
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
    ...(m.extra ? [m.extra] : []),
    '---',
  ]
  const parts = [fm.join('\n')]
  if (d.summary) parts.push(`> [!summary] 这条讲什么\n> ${d.summary.replace(/\n+/g, ' ')}`)
  // 来源说明由程序加，不交给 AI
  if (m.type === '音频' || m.type === '视频') parts.push('> [!note] 内容来自语音转写，没有分析画面。')
  if (m.type === '图片') parts.push('> [!note] 仅根据图片整理。')
  for (const i of images) parts.push(imageLine(i))
  parts.push(d.body)
  return parts.join('\n\n') + '\n'
}

const SOURCE_TYPES: SourceType[] = ['文字', '图片', '音频', '视频', '文档']

const NoteFileSchema = z.object({
  originalText: z.string(),
  title: z.string(),
  domain: z.string(),
  stem: z.string(),
  kind: z.string().catch(''),
  mode: z.string().catch(''),
  tags: z.array(z.string()).catch([]),
  keywords: z.array(z.string()).catch([]),
  source: z.string().catch(''),
  platform: z.string().catch(''),
  author: z.string().catch(''),
  created: z.string().catch(''),
  cover: z.string().catch(''),
  extra: z.string().catch(''),
  content: z.string().catch(''),
})

/** 外壳 read_note 的结果。类型、整理方式不认识（别的程序写的笔记）时按文字、要点提炼算 */
export function parseNoteFile(raw: unknown) {
  const f = NoteFileSchema.parse(raw)
  return {
    ...f,
    kind: SOURCE_TYPES.find((t) => t === f.kind) ?? ('文字' as SourceType),
    mode: MODES.find((m) => m === f.mode) ?? ('要点提炼' as Mode),
  }
}
export type NoteFile = ReturnType<typeof parseNoteFile>

const IMAGE_LINE = /^!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)$/

/**
 * 打开已有笔记：把 buildMarkdown 写出的正文拆回摘要、开头的图片和正文（来源说明那一行丢掉，保存时按类型再加）。
 * 只认正文最前面连着的这几块，别处的图片留在正文里
 */
export function parseNoteBody(content: string): { summary: string; images: NoteImage[]; body: string } {
  // 分隔符也留下，正文部分直接拼回，避免压缩代码块内的空行。
  const blocks = content
    .replace(/^\s*\n/, '')
    .trimEnd()
    .split(/(\n\s*\n)/)
  let summary = ''
  const images: NoteImage[] = []
  let i = 0
  for (; i < blocks.length; i += 2) {
    const b = blocks[i].trim()
    const lines = b.split('\n')
    if (b.startsWith('> [!summary]') && !summary) {
      summary = lines
        .slice(1)
        .map((l) => l.replace(/^>\s?/, ''))
        .join(' ')
        .trim()
    } else if (b === '> [!note] 内容来自语音转写，没有分析画面。' || b === '> [!note] 仅根据图片整理。') {
      continue
    } else if (lines.length === 1 && IMAGE_LINE.test(b)) {
      const m = IMAGE_LINE.exec(b)!
      const size = /^(.*)\|([1-9]\d*)$/.exec(m[1])
      const width = size ? Number(size[2]) : undefined
      images.push({
        caption: size && Number.isSafeInteger(width) ? size[1] : m[1],
        path: m[2].replace(/^<|>$/g, ''),
        ...(Number.isSafeInteger(width) ? { width } : {}),
      })
    } else break
  }
  return { summary, images, body: blocks.slice(i).join('').trimEnd() }
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
