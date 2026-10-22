// 配置的结构、默认值和检查。纯 TypeScript，不依赖外壳（方案第 11 节“可维护性”）

import { z } from 'zod'

export const SERVICE_KINDS = ['text', 'vision', 'asr'] as const
export type ServiceKind = (typeof SERVICE_KINDS)[number]

export const SERVICE_LABELS: Record<ServiceKind, string> = {
  text: '文字整理',
  vision: '看图理解',
  asr: '语音转写',
}

/** “其他”不能删除（方案第 10.2 节） */
export const OTHER_DOMAIN_ID = 99

// S0 确定的服务：文字和图片用 deepseek-flash，转写用硅基流动 SenseVoice
const DEFAULT_SERVICES: Record<ServiceKind, { baseUrl: string; model: string }> = {
  text: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  vision: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  asr: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' },
}

const DEFAULT_DOMAINS = [
  { id: 1, name: '为人处世' },
  { id: 2, name: '职场求职' },
  { id: 3, name: '品牌商业' },
  { id: 4, name: 'AI与Agent' },
  { id: 5, name: '设计UI' },
  { id: 6, name: '金融理财' },
  { id: 7, name: '思考与表达' },
  { id: OTHER_DOMAIN_ID, name: '其他' },
]

const serviceSchema = (kind: ServiceKind) =>
  z
    .object({
      baseUrl: z.string().catch(DEFAULT_SERVICES[kind].baseUrl), // OpenAI 兼容接口地址，不含 /chat/completions 等路径
      model: z.string().catch(DEFAULT_SERVICES[kind].model),
      apiKey: z.string().catch(''),
      // 单价（元 / 百万 tokens，选填，F14）：填了才算花费；填错的项当没填
      price: z
        .object({
          input: z.number().nonnegative().optional().catch(undefined),
          cachedInput: z.number().nonnegative().optional().catch(undefined),
          output: z.number().nonnegative().optional().catch(undefined),
        })
        .optional()
        .catch(undefined),
    })
    .catch({ ...DEFAULT_SERVICES[kind], apiKey: '' })

const DomainSchema = z.object({
  id: z.number().int(), // 交给 AI 选择的编号；改名不改编号
  name: z.string(), // 同时是收藏库里的文件夹名
})

/**
 * 配置文件的结构。读取时缺的或坏掉的字段用默认值补上（方便以后加字段）；
 * 整个文件不是合法 JSON 时由调用方报错，不悄悄换成默认配置
 */
const ConfigSchema = z.object({
  schema: z.literal(1).catch(1),
  vaultPath: z.string().catch(''),
  // F31：obsidian 时笔记存到仓库里的 subfolder，“打开笔记”用 Obsidian；folder 时直接存在 vaultPath。
  // otherPath 是另一种方式上次用的文件夹，切回去时还原（见 switchVaultKind）
  vault: z
    .object({
      kind: z.enum(['folder', 'obsidian']).catch('folder'),
      subfolder: z.string().catch(''),
      otherPath: z.string().optional().catch(undefined),
    })
    .catch({ kind: 'folder', subfolder: '' }),
  services: z
    .object({ text: serviceSchema('text'), vision: serviceSchema('vision'), asr: serviceSchema('asr') })
    .catch(() => defaultServices()),
  domains: z
    .array(DomainSchema)
    .min(1)
    .catch(() => DEFAULT_DOMAINS.map((d) => ({ ...d }))),
})

export type Config = z.infer<typeof ConfigSchema>
export type ServiceConfig = Config['services'][ServiceKind]
export type Domain = z.infer<typeof DomainSchema>

function defaultServices(): Config['services'] {
  return {
    text: { ...DEFAULT_SERVICES.text, apiKey: '' },
    vision: { ...DEFAULT_SERVICES.vision, apiKey: '' },
    asr: { ...DEFAULT_SERVICES.asr, apiKey: '' },
  }
}

export function defaultConfig(): Config {
  return ConfigSchema.parse({})
}

/** 读取已保存的配置；json 为 null 表示还没有配置过 */
export function parseConfig(json: string | null): Config {
  return ConfigSchema.parse(json ? JSON.parse(json) : {})
}

/** 接口地址只允许 HTTPS：密钥和内容不能明文传输（《代码规范》第 7 节第 8 条）。没问题时返回 null */
export function checkBaseUrl(url: string): string | null {
  return /^https:\/\/[^\s/]+/i.test(url.trim()) ? null : '接口地址必须以 https:// 开头（加密连接）'
}

export function isServiceConfigured(s: ServiceConfig): boolean {
  return !!(s.model.trim() && s.apiKey.trim()) && checkBaseUrl(s.baseUrl) === null
}

/** S1 首次使用：收藏库和三项服务都填好才算配置完成（方案第 6.3 节） */
export function isConfigComplete(c: Config): boolean {
  return !!c.vaultPath && SERVICE_KINDS.every((k) => isServiceConfigured(c.services[k]))
}

/** 设置页里的密钥显示为 sk-****abcd（方案第 13 节） */
export function maskKey(key: string): string {
  if (!key) return ''
  const prefix = key.startsWith('sk-') ? 'sk-' : ''
  return `${prefix}****${key.slice(-4)}`
}

/** 文件夹名里不能有的字符（方案第 8 节） */
const ILLEGAL = /[\\/:*?"<>|]/

/** 检查领域名；没问题时返回 null */
export function checkDomainName(name: string, domains: Domain[], selfId?: number): string | null {
  const n = name.trim()
  if (!n) return '领域名不能为空'
  if (ILLEGAL.test(n)) return '领域名里不能有 \\ / : * ? " < > | 这些字符'
  if (n.length > 20) return '领域名不要超过 20 个字'
  if (domains.some((d) => d.name === n && d.id !== selfId)) return '已经有这个领域了'
  return null
}

/** 换收藏库方式：两种方式各记各的文件夹，换过去用那边上次的，当前的记下来留着换回来用 */
export function switchVaultKind(c: Config, kind: Config['vault']['kind']): Config {
  if (c.vault.kind === kind) return c
  return { ...c, vaultPath: c.vault.otherPath ?? '', vault: { ...c.vault, kind, otherPath: c.vaultPath } }
}

/** 给用户看的存放位置：Obsidian 是“仓库名 / 子文件夹”，普通文件夹是文件夹名（设置页、确认页、保存成功页共用） */
export function storeLabel(c: Config): string {
  const name = c.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const sub = c.vault.kind === 'obsidian' ? c.vault.subfolder.split(/[\\/]/).filter((p) => p.trim()) : []
  return [name, ...sub.map((p) => p.trim())].join(' / ')
}

/** 笔记和附件实际写入的文件夹 */
export function notesRoot(c: Config): string {
  const sub = c.vault.kind === 'obsidian' ? c.vault.subfolder.split(/[\\/]/).filter((p) => p.trim()) : []
  return [c.vaultPath, ...sub.map((p) => p.trim())].join('\\')
}

/** 检查 Obsidian 仓库里的子文件夹（可以多层，用 / 或 \ 分开）；没问题时返回 null */
export function checkSubfolder(sub: string): string | null {
  const t = sub.trim()
  if (!t) return null
  const parts = t.split(/[\\/]/)
  if (parts.some((p) => p.trim() === '.' || p.trim() === '..')) return '子文件夹名里不能有“..”'
  if (/[:*?"<>|]/.test(t)) return '子文件夹名里不能有 : * ? " < > | 这些字符'
  if (parts.some((p) => !p.trim())) return '子文件夹名不能有空的一层'
  return null
}

/** 设置页“新建文件夹”：只建一层，在仓库最外层；existing 是仓库里已有的文件夹（list_subfolders 的结果）。没问题时返回 null */
export function checkNewFolderName(name: string, existing: string[]): string | null {
  const n = name.trim()
  if (!n) return '文件夹名不能为空'
  if (ILLEGAL.test(n)) return '文件夹名里不能有 \\ / : * ? " < > | 这些字符'
  if (n === '.' || n === '..') return '文件夹名不能是“.”或“..”'
  if (existing.includes(n)) return `仓库里已经有“${n}”文件夹了，可以直接在上面选`
  return null
}

/** 新增领域（确认页领域下拉里直接新建，US4）：加在“其他”前面。名字不合规时返回原因 */
export function addDomain(c: Config, name: string): { config: Config; domain: Domain } | string {
  const err = checkDomainName(name, c.domains)
  if (err) return err
  const domain = { id: nextDomainId(c.domains), name: name.trim() }
  const others = c.domains.filter((d) => d.id === OTHER_DOMAIN_ID)
  const rest = c.domains.filter((d) => d.id !== OTHER_DOMAIN_ID)
  return { config: { ...c, domains: [...rest, domain, ...others] }, domain }
}

export function nextDomainId(domains: Domain[]): number {
  const ids = domains.map((d) => d.id).filter((id) => id !== OTHER_DOMAIN_ID)
  let id = Math.max(0, ...ids) + 1
  if (id === OTHER_DOMAIN_ID) id++
  return id
}
