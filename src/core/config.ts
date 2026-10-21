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

export function nextDomainId(domains: Domain[]): number {
  const ids = domains.map((d) => d.id).filter((id) => id !== OTHER_DOMAIN_ID)
  let id = Math.max(0, ...ids) + 1
  if (id === OTHER_DOMAIN_ID) id++
  return id
}
