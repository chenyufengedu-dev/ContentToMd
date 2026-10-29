// 收藏库页预览用的假外壳（/dev/pages.html?p=library）：假笔记 + 用画布画的假封面图。
// &lib=empty 还没有收藏；&lib=fail 有 2 个文件读不出；&lib=many 120 条（看按需加载）；&lib=missing 文件夹找不到

import { SAMPLE_JOB } from './sample'

const SAMPLES = [
  {
    title: '为一周阅读安排三个小目标',
    domain: '学习阅读',
    tags: ['阅读计划', '习惯', '复盘'],
    cover: '',
    body: '> [!summary] 这条讲什么\n> 每周安排三个可以完成的小目标，让阅读和回顾都留有时间。\n\n## 安排\n- 选一个问题作为本周主题\n- 读完一章后写三句自己的理解',
  },
  {
    title: SAMPLE_JOB.draft!.title,
    domain: '学习阅读',
    tags: SAMPLE_JOB.draft!.tags,
    cover: '',
    body: SAMPLE_JOB.draft!.body,
  },
  {
    title: '阅读进度看板的配色和布局草稿',
    domain: '设计UI',
    tags: ['配色', '仪表盘'],
    cover: '../附件/2026-10/dashboard.png',
    body: '浅色底、卡片式分区，主色只用在数据高亮上。',
  },
  {
    title: '秋季通勤搭配的个人配色练习',
    domain: '其他',
    tags: ['穿搭'],
    cover: '../附件/2026-10/outfit.png',
    body: '驼色大衣配灰色针织，下装深色阔腿裤。',
  },
  {
    title: '让整理要求更清楚的五个练习',
    domain: 'AI与Agent',
    tags: ['提示词'],
    cover: '',
    body: '先写目的，再列材料范围；说明必须保留的内容，用一个自拟例子约定格式，最后检查是否遗漏了限制。',
  },
  {
    title: '为一次模拟面试准备经历清单',
    domain: '职场求职',
    tags: ['面试', '简历'],
    cover: '',
    body: '面试不仅是能力的考察，也是沟通和价值观的匹配。\n\n> [!info]- 图片中的文字\n> 个人简历模板',
  },
]

const COVER_COLORS: Record<string, [string, string]> = {
  '附件/2026-10/dashboard.png': ['#eef0ff', '#5b5bd6'],
  '附件/2026-10/outfit.png': ['#efe7df', '#7a5a43'],
}

/** 画一张假的封面：浅底上几个色块，看得出是图就行 */
async function fakeCover(path: string): Promise<ArrayBuffer> {
  const [bg, fg] = COVER_COLORS[path] ?? ['#e5e7eb', '#9ca3af']
  const c = document.createElement('canvas')
  c.width = 600
  c.height = 400
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, 600, 400)
  g.fillStyle = fg
  g.globalAlpha = 0.85
  g.fillRect(40, 40, 140, 320)
  g.globalAlpha = 0.35
  g.fillRect(210, 40, 350, 150)
  g.fillRect(210, 210, 160, 150)
  g.fillRect(400, 210, 160, 150)
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
  return blob.arrayBuffer()
}

export function installLibraryShell(mode: string | null) {
  const recoveries = new Map<string, string>()
  const count = mode === 'many' ? 120 : mode === 'empty' ? 0 : SAMPLES.length
  const notes = Array.from({ length: count }, (_, i) => {
    const s = SAMPLES[i % SAMPLES.length]
    const day = String(21 - (i % 21)).padStart(2, '0')
    return {
      ...s,
      path: `${s.domain}/${s.title}-${i}.md`,
      title: i < SAMPLES.length ? s.title : `${s.title}（${i + 1}）`,
      created: `2026-10-${day}`,
      keywords: [],
    }
  })
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: { relPath?: string; root?: string; path?: string; json?: string | null }) => {
        if (cmd === 'edit_recovery_list') return [...recoveries.values()]
        if (cmd === 'edit_recovery_write') {
          const key = JSON.stringify([args!.root, args!.path])
          if (args!.json == null) recoveries.delete(key)
          else recoveries.set(key, args!.json)
          return
        }
        if (cmd === 'list_notes') {
          if (mode === 'missing') throw new Error('找不到文件夹')
          return { notes, failed: mode === 'fail' ? ['设计UI/坏的.md', '其他/乱码.md'] : [] }
        }
        if (cmd === 'read_cover') {
          if (mode === 'imgmiss' && args!.relPath!.includes('outfit')) throw new Error('找不到图片')
          return fakeCover(args!.relPath!)
        }
        // 笔记页（?p=note）：读到的是第 3 条（有封面图）。&note=gone 笔记已经不在；&note=imgmiss 有一张图读不到
        if (cmd === 'read_note') {
          if (mode === 'gone') throw new Error('找不到这条笔记了')
          const n = notes[2]
          return {
            originalText: '隔离预览的原始文件',
            title: n.title,
            domain: n.domain,
            stem: n.title,
            kind: '视频',
            mode: '要点提炼',
            tags: n.tags,
            keywords: ['仪表盘', '配色'],
            source: 'https://v.douyin.com/abcdef/',
            platform: '抖音',
            author: '设计师小王',
            created: n.created,
            cover: n.cover,
            extra: '',
            content: `
> [!summary] 这条讲什么
> 浅色底、卡片式分区，主色只用在数据高亮上。

> [!note] 内容来自语音转写，没有分析画面。

![仪表盘](${n.cover})

![穿搭](../附件/2026-10/outfit.png)

## 配色

- 浅灰底，白色卡片
- 主色只用在数据高亮

## 布局

卡片之间留白宽一点，数据放在左上。
`,
          }
        }
        if (cmd === 'save_note') {
          ;(window as unknown as { __saved: unknown }).__saved = args
          const a = args as unknown as { domain: string; stem: string }
          return `${a.domain}/${a.stem}.md`
        }
        if (cmd === 'delete_note') return ['附件/2026-10/dashboard.png']
        if (cmd === 'restore_note') return null
        if (cmd === 'list_vault_tags') return ['提示词', '配色', '仪表盘']
        throw new Error('预览里没有外壳')
      },
    },
  })
}
