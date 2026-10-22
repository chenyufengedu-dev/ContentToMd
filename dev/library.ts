// 收藏库页预览用的假外壳（/dev/pages.html?p=library）：假笔记 + 用画布画的假封面图。
// &lib=empty 还没有收藏；&lib=fail 有 2 个文件读不出；&lib=many 120 条（看按需加载）；&lib=missing 文件夹找不到

const SAMPLES = [
  {
    title: 'Claude 对话标题批量整理提示词与执行步骤',
    domain: 'AI与Agent',
    tags: ['提示词', 'Claude', '效率'],
    cover: '',
    body: '> [!summary] 这条讲什么\n> 把多个对话标题整理成结构化的 Markdown 文档，按主题分类并生成清晰的目录。\n\n## 用法\n- 在 Claude Desktop 的 Code 标签页开一个新对话\n- 把提示词贴进去',
  },
  {
    title: '商务礼仪三重点：摆正位置、端正态度、分清场合',
    domain: '为人处世',
    tags: ['商务礼仪'],
    cover: '',
    body: '> [!summary] 这条讲什么\n> 在不同场合中保持恰当的行为举止，是建立良好人际关系的基础。\n\n## 摆正位置\n- 尊重上级是天职，尊重平级是本分，尊重下级是美德',
  },
  {
    title: 'Dribbble 卡片式仪表盘的配色和布局',
    domain: '设计UI',
    tags: ['配色', '仪表盘'],
    cover: '../附件/2026-10/dashboard.png',
    body: '浅色底、卡片式分区，主色只用在数据高亮上。',
  },
  {
    title: '秋冬通勤穿搭的色彩搭配参考',
    domain: '其他',
    tags: ['穿搭'],
    cover: '../附件/2026-10/outfit.png',
    body: '驼色大衣配灰色针织，下装深色阔腿裤。',
  },
  {
    title: '高质量提示词的 5 个写作原则',
    domain: 'AI与Agent',
    tags: ['提示词'],
    cover: '',
    body: '好的提示词应该具备清晰的角色设定、明确的任务目标、必要的背景信息和具体的输出要求。',
  },
  {
    title: '产品经理面试常见问题与回答思路',
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
      invoke: async (cmd: string, args?: { relPath?: string }) => {
        if (cmd === 'list_notes') {
          if (mode === 'missing') throw new Error('找不到文件夹')
          return { notes, failed: mode === 'fail' ? ['设计UI/坏的.md', '其他/乱码.md'] : [] }
        }
        if (cmd === 'read_cover') return fakeCover(args!.relPath!)
        throw new Error('预览里没有外壳')
      },
    },
  })
}
