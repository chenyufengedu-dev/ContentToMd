// 长文的处理策略（2026-10-22 用《三体》片段实测后定的，见 docs/进度.md）：
// 要点提炼一次装整段，最多 8 万字；原文精修要把全文重写一遍，一次装太长会被 AI 悄悄改成摘要，
// 所以分成每块约 3000 字、同时最多 3 块并行精修，最多 2 万字（等太久用户受不了）
import type { Mode } from './note'

export const MAX_CHARS: Record<Mode, number> = { 要点提炼: 80000, 原文精修: 20000, 视觉收藏: 80000 }

/** 原文精修：不超过这个字数就一次整理，超过了才分块 */
export const REFINE_SINGLE_MAX = 4000
/** 分块时每块约多少字 */
export const REFINE_CHUNK = 3000
/** 分块精修同时最多跑几块 */
export const CONCURRENCY = 3

const wan = (n: number) => `${n / 10000} 万字`

/** 这份文字对这种整理方式太长时，返回给用户看的说明；没问题返回 null */
export function lengthProblem(mode: Mode, chars: number): string | null {
  const max = MAX_CHARS[mode]
  if (chars <= max) return null
  const n = chars.toLocaleString()
  if (mode === '原文精修')
    return `这份内容有 ${n} 字，超过「原文精修」最多 ${wan(max)}的上限，请改用「要点提炼」（最多 ${wan(MAX_CHARS.要点提炼)}），或拆成几份再放入`
  return `这份内容有 ${n} 字，超过一次最多 ${wan(max)}的上限，请拆成几份再放入`
}

/** 一整段特别长时在句子结尾拆开，攒到不超过 target；一句就超过 target 的硬切 */
function splitSentences(p: string, target: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of p.split(/(?<=[。！？!?…])/)) {
    if (cur && cur.length + s.length > target) {
      out.push(cur)
      cur = ''
    }
    cur += s
    while (cur.length > target) {
      out.push(cur.slice(0, target))
      cur = cur.slice(target)
    }
  }
  if (cur) out.push(cur)
  return out
}

/** 按段落攒成每块约 target 字，段落不拆开；单个段落比 target 还长时在句子结尾拆 */
export function splitTextChunks(text: string, target = REFINE_CHUNK): string[] {
  if (!text.trim()) return []
  const pieces = text.split('\n').flatMap((p) => (p.length > target ? splitSentences(p, target) : [p]))
  const chunks: string[] = []
  let cur = ''
  for (const p of pieces) {
    if (!cur) cur = p
    else if (cur.length + 1 + p.length <= target) cur += `\n${p}`
    else {
      chunks.push(cur)
      cur = p
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** 精修的输出比原文短了四成以上，说明 AI 把它悄悄改成了摘要 */
export const isCondensed = (srcLen: number, outLen: number) => outLen < srcLen * 0.6

/** 同时最多跑 limit 个，结果按原来的顺序返回；有一个失败就报错，后面没开始的不再开始 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
