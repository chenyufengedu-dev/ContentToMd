import { describe, expect, it } from 'vitest'
import { matchToSource, splitSentences } from './sourceMatch'
import { SAMPLE_JOB } from '../../dev/sample'

const TRANSCRIPT = SAMPLE_JOB.transcript!

describe('splitSentences', () => {
  it('按句末标点切分，记下每句在原文里的位置', () => {
    const s = splitSentences('第一个重点呢叫做摆正位置。第二个重点呢叫做端正态度！有遇到过吧？')
    expect(s.map((x) => x.text)).toEqual(['第一个重点呢叫做摆正位置。', '第二个重点呢叫做端正态度！', '有遇到过吧？'])
    expect(s[1]).toMatchObject({ start: 13, end: 26 })
  })

  it('最后一句没有标点也保留，空白不算一句', () => {
    expect(splitSentences('好的。\n\n后面还有').map((x) => x.text)).toEqual(['好的。', '后面还有'])
  })
})

describe('matchToSource：正文一段对应原文哪里', () => {
  const sentences = splitSentences(TRANSCRIPT)
  const textOf = (blockIdx: number, r: ReturnType<typeof matchToSource>) => {
    const m = r.matches[blockIdx]
    return m
      ? sentences
          .slice(m.from, m.to + 1)
          .map((x) => x.text)
          .join('')
      : null
  }

  it('识别错字、口头禅都不影响找到原句', () => {
    const r = matchToSource(['尊重上级是天职，尊重平级是本分，尊重下级是美德。'], TRANSCRIPT)
    expect(textOf(0, r)).toContain('尊重上级是我们的天职，尊重评级是本分，尊重下级是美德')
  })

  it('改写过但意思和用字接近的要点也能找到', () => {
    const r = matchToSource(['你以什么状态对待工作、对待自己，它也像一面镜子回馈给你。'], TRANSCRIPT)
    expect(textOf(0, r)).toContain('当你以什么样的状态去对待你的工作')
  })

  it('带【?原文：…】标记的段落按去掉标记后的文字比对', () => {
    const r = matchToSource(['这是企业发展之道，叫“在其位谋其政【?原文：在其位谋其道】”。'], TRANSCRIPT)
    expect(textOf(0, r)).toContain('这是企业发展之道')
  })

  it('原文里没有的内容不硬配', () => {
    const r = matchToSource(['发布时可以设置基础、进阶或挑战难度，并选择全班或指定学生。'], TRANSCRIPT)
    expect(r.matches[0]).toBeNull()
  })

  it('太短的段落（比如只有几个字）不比对', () => {
    expect(matchToSource(['摆正位置'], TRANSCRIPT).matches[0]).toBeNull()
  })

  it('样本笔记的每一条要点都能定位到原文', () => {
    const blocks = SAMPLE_JOB.draft!.body.split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2))
    const r = matchToSource(blocks, TRANSCRIPT)
    expect(r.matches.filter((m) => m === null)).toHaveLength(0)
  })
})

describe('matchToSource：原文里没被用到的句子', () => {
  it('笔记没写到的有内容的句子标为未用到，很短的语气句不标', () => {
    const r = matchToSource(['尊重上级是天职，尊重平级是本分，尊重下级是美德。'], TRANSCRIPT)
    const sentences = splitSentences(TRANSCRIPT)
    const unused = sentences.filter((_, i) => r.unused[i]).map((x) => x.text)
    expect(unused.join('')).toContain('一语成谶')
    expect(unused).not.toContain('有遇到过吧。')
    const matched = r.matches[0]!
    for (let i = matched.from; i <= matched.to; i++) expect(r.unused[i]).toBe(false)
  })
})
