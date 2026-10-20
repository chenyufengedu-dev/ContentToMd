// 原文定位（F30）：正文的每一段对应原文的哪几句，以及原文里哪些句子没被笔记用到。
// 只在本地比对文字，不调用 AI。按“字对”（相邻两个字）的重合程度打分，对识别错字和口头禅不敏感

export interface Sentence {
  text: string
  start: number // 在原文里的起止位置（不含 end）
  end: number
}

export interface Match {
  from: number // 句子下标，含
  to: number // 句子下标，含
  score: number // 0～1：正文这一段的字对有多少出现在这几句里
}

/** 一段至少多少个有效字才比对；太短的（比如小标题“摆正位置”）容易配错 */
const MIN_BLOCK_CHARS = 6
/** 原文里少于这么多有效字的句子（“有遇到过吧”）不算“没被用到” */
const MIN_UNUSED_CHARS = 6
/** 低于这个分数就不显示对应，宁可不指也不指错 */
const MIN_SCORE = 0.4
/** 最多把相邻几句合起来当作一处来源 */
const MAX_WINDOW = 3
/** 多合一句要多付的分，避免总是选最长的窗口 */
const WINDOW_PENALTY = 0.08

/** 按句末标点切分；最后一句没有标点也保留 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  const re = /[^。！？!?\n]+[。！？!?]*|[。！？!?]+/g
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    if (!t) continue
    const start = m.index + lead
    out.push({ text: t, start, end: start + t.length })
  }
  return out
}

/** 去掉标点、空白和【?原文：…】标记的括号，只留下用来比对的字 */
function normalize(s: string): string {
  return s.replace(/【\?(原文：)?|】/g, '').replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** blocks：正文里的每一段（段落、列表项、引用），按出现顺序 */
export function matchToSource(
  blocks: string[],
  transcript: string,
): { sentences: Sentence[]; matches: (Match | null)[]; unused: boolean[] } {
  const sentences = splitSentences(transcript)
  const sentenceGrams = sentences.map((s) => bigrams(normalize(s.text)))
  const used = new Array<boolean>(sentences.length).fill(false)

  const matches = blocks.map((block): Match | null => {
    const norm = normalize(block)
    if (norm.length < MIN_BLOCK_CHARS) return null
    const target = bigrams(norm)
    let best: (Match & { rank: number }) | null = null
    for (let from = 0; from < sentences.length; from++) {
      const window = new Set<string>()
      for (let len = 1; len <= MAX_WINDOW && from + len <= sentences.length; len++) {
        for (const g of sentenceGrams[from + len - 1]) window.add(g)
        let hit = 0
        for (const g of target) if (window.has(g)) hit++
        const score = hit / target.size
        const rank = score - WINDOW_PENALTY * (len - 1)
        if (!best || rank > best.rank) best = { from, to: from + len - 1, score, rank }
      }
    }
    if (!best || best.score < MIN_SCORE) return null
    for (let i = best.from; i <= best.to; i++) used[i] = true
    return { from: best.from, to: best.to, score: best.score }
  })

  const unused = sentences.map((s, i) => !used[i] && normalize(s.text).length >= MIN_UNUSED_CHARS)
  return { sentences, matches, unused }
}
