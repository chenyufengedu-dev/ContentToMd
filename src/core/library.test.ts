import { describe, expect, it } from 'vitest'
import {
  cardDate,
  coverPath,
  domainCounts,
  filterNotes,
  parseNoteList,
  previewLines,
  tagCounts,
  type LibraryNote,
} from './library'

const note = (p: Partial<LibraryNote> & { path: string }): LibraryNote => ({
  title: p.path,
  domain: p.path.split('/')[0],
  created: '',
  tags: [],
  keywords: [],
  cover: '',
  body: '',
  ...p,
})

const NOTES = [
  note({
    path: 'AI与Agent/提示词.md',
    title: '高质量提示词的 5 个写作原则',
    created: '2026-10-16',
    tags: ['提示词'],
    keywords: ['角色设定'],
    body: '好的提示词应该具备清晰的角色设定。',
  }),
  note({
    path: 'AI与Agent/Claude.md',
    title: 'Claude 对话标题批量整理提示词与执行步骤',
    created: '2026-10-21',
    tags: ['提示词', 'Claude'],
  }),
  note({
    path: '职场求职/面试.md',
    title: '产品经理面试常见问题与回答思路',
    created: '2026-10-15',
    tags: ['面试', '简历'],
    body: '> [!info]- 图片中的文字\n> 个人简历模板',
  }),
  note({ path: '为人处世/礼仪.md', title: '商务礼仪三重点', created: '2026-10-20', tags: ['商务礼仪'] }),
]

describe('收藏库筛选', () => {
  it('默认按收藏日期从新到旧', () => {
    expect(filterNotes(NOTES, { domain: null, tags: [], query: '' }).map((n) => n.created)).toEqual([
      '2026-10-21',
      '2026-10-20',
      '2026-10-16',
      '2026-10-15',
    ])
  })

  it('领域一次一个，标签多选要同时带有', () => {
    expect(filterNotes(NOTES, { domain: 'AI与Agent', tags: [], query: '' })).toHaveLength(2)
    expect(filterNotes(NOTES, { domain: null, tags: ['提示词', 'Claude'], query: '' }).map((n) => n.path)).toEqual([
      'AI与Agent/Claude.md',
    ])
  })

  it('搜索标题、关键词、正文（含图片中的文字），不分大小写，几个词都要有', () => {
    const find = (query: string) => filterNotes(NOTES, { domain: null, tags: [], query }).map((n) => n.path)
    expect(find('claude')).toEqual(['AI与Agent/Claude.md'])
    expect(find('角色设定')).toEqual(['AI与Agent/提示词.md'])
    expect(find('简历模板')).toEqual(['职场求职/面试.md'])
    expect(find('提示词 写作')).toEqual(['AI与Agent/提示词.md'])
    expect(find('不存在的词')).toEqual([])
  })

  it('领域条数：设置里的领域都列出（没有笔记的是 0），设置里没有的文件夹排在后面', () => {
    const counts = domainCounts([...NOTES, note({ path: '旧领域/a.md' })], ['为人处世', 'AI与Agent', '其他'])
    expect(counts).toEqual([
      { name: '为人处世', count: 1 },
      { name: 'AI与Agent', count: 2 },
      { name: '其他', count: 0 },
      { name: '职场求职', count: 1 },
      { name: '旧领域', count: 1 },
    ])
  })

  it('标签按用的次数从多到少', () => {
    const tags = tagCounts(NOTES)
    expect(tags[0]).toEqual({ name: '提示词', count: 2 })
    expect(tags.map((t) => t.count)).toEqual([2, 1, 1, 1, 1])
  })
})

describe('卡片显示', () => {
  it('卡片背面的正文：去掉提示框标记、图片、标题符号和列表符号，取前几行', () => {
    const body = [
      '> [!summary] 这条讲什么',
      '> 三个重点',
      '',
      '![封面](附件/2026-10/a.png)',
      '## 摆正位置',
      '- 尊重上级是天职',
      '1. 尊重平级是本分',
    ].join('\n')
    expect(previewLines(body, 4)).toEqual(['三个重点', '摆正位置', '尊重上级是天职', '尊重平级是本分'])
  })

  it('封面路径相对笔记所在文件夹，换算成相对存放文件夹', () => {
    const n = note({ path: '其他/小河马.md', cover: '../附件/2026-10/2026-10-21-小河马-1.png' })
    expect(coverPath(n)).toBe('附件/2026-10/2026-10-21-小河马-1.png')
    expect(coverPath({ ...n, cover: '..\\附件\\a.png' })).toBe('附件/a.png')
    expect(coverPath({ ...n, cover: '' })).toBe('')
    expect(coverPath({ ...n, cover: '../../别处/a.png' })).toBe('') // 跳出存放文件夹的不认
  })

  it('日期：今年的只写月-日，往年的写全', () => {
    expect(cardDate('2026-10-18', 2026)).toBe('10-18')
    expect(cardDate('2025-03-02', 2026)).toBe('2025-03-02')
    expect(cardDate('', 2026)).toBe('')
  })

  it('外壳返回的列表按约定校验，缺的字段补默认值', () => {
    const list = parseNoteList({ notes: [{ path: 'a/b.md', title: 'b', domain: 'a' }], failed: [] })
    expect(list.notes[0]).toEqual(note({ path: 'a/b.md', title: 'b' }))
  })
})
