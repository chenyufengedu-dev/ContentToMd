// F14 费用记录（方案第 5、10.1 节）：每次调用服务记一行（时间、服务、模型、密钥编号、用量、估算金额），
// 保存成功页显示这一条花了多少，设置页按密钥显示本月和累计。
// 价格会变，软件不内置价格：用户在设置里给每项服务填（选填），填了才算钱，没填只记用量和次数。
// 金额 = 服务返回的用量 × 用户填的单价，是估算，以服务商账单为准

import type { ServiceKind } from './config'

/** 服务返回的用量（OpenAI 兼容格式）。命中缓存的输入：DeepSeek 给 prompt_cache_hit_tokens，OpenAI 风格给 prompt_tokens_details.cached_tokens */
export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

/**
 * 用户填的单价。整理、看图：元 / 百万 tokens，cachedInput 不填时命中缓存的输入也按 input 算；
 * 转写：perHour，元 / 小时音频（按时长计费的服务填，免费模型不填）
 */
export interface Price {
  input?: number
  cachedInput?: number
  output?: number
  perHour?: number
}

/** usage.jsonl 的一行。只存密钥的编号，不存密钥 */
export interface UsageRecord {
  time: string // ISO
  service: ServiceKind
  model: string
  keyId: string
  /** 估算金额（元）；没填价格时为 null */
  cost: number | null
  tokens?: Usage
  /** 转写的这一段音频有多少秒 */
  seconds?: number
  /** 哪一条收藏（文件名），方便以后对账 */
  item?: string
}

/** 价格填全了（输入和输出都有）才算钱 */
export const hasPrice = (p?: Price): p is Price & { input: number; output: number } =>
  typeof p?.input === 'number' && typeof p?.output === 'number'

/** 没填价格或服务没返回用量时返回 null（不知道花了多少） */
export function estimateCost(price: Price | undefined, usage: Usage | undefined): number | null {
  if (!hasPrice(price) || !usage) return null
  const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens ?? 0) - hit)
  const cached = price.cachedInput ?? price.input
  return (hit * cached + miss * price.input + (usage.completion_tokens ?? 0) * price.output) / 1e6
}

/** 转写：音频秒数 × 用户填的每小时单价；没填价格或不知道时长时返回 null */
export function estimateAsrCost(price: Price | undefined, seconds: number | undefined): number | null {
  if (typeof price?.perHour !== 'number' || seconds === undefined) return null
  return (seconds / 3600) * price.perHour
}

/** 给人看的金额：不到 1 分钱时不显示一串小数 */
export function formatYuan(y: number): string {
  if (y === 0) return '0 元'
  if (y < 0.01) return '少于 0.01 元'
  return `约 ${y.toFixed(2)} 元`
}

/** 密钥的编号：SHA-256 的前 8 位。换了密钥编号就变，设置页按编号分开算 */
export async function keyId(apiKey: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey.trim()))
  return [...new Uint8Array(hash)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 某把密钥的本月（北京时间）花费、累计花费、调用次数、没算钱的次数（当时没填价格） */
export function summarize(records: UsageRecord[], key: string, now: Date) {
  const month = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 7)
  const thisMonth = month(now)
  const mine = records.filter((r) => r.keyId === key)
  const sum = (rs: UsageRecord[]) => rs.reduce((s, r) => s + (r.cost ?? 0), 0)
  return {
    month: sum(mine.filter((r) => month(new Date(r.time)) === thisMonth)),
    total: sum(mine),
    calls: mine.length,
    unknown: mine.filter((r) => r.cost === null).length,
  }
}

/** usage.jsonl 的内容转成记录；坏掉的行跳过 */
export function parseUsage(text: string): UsageRecord[] {
  return text.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as UsageRecord] : []
    } catch {
      return []
    }
  })
}
