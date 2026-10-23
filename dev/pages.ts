// 设置页、投放页预览（只在开发时用：npx vite 后打开 /dev/pages.html）。
// ?p=library 收藏库页（&lib=empty|fail|many|missing）；?p=note 笔记页（&note=gone|imgmiss，&obs=1）；?p=settings 设置页（&freeze=卡片id:毫秒 点开这张卡片并把动画停在第几毫秒，逐帧检查动画用）；?p=proc 处理中（出字前），&typing=1 模拟逐字生成，&failed=1 处理失败；?p=saved 保存成功，&imgfail=1 有图片没写入。；?drop=video|images|txt|bad|draft 投放页放入内容后的样子。
// 不连外壳，点保存、选文件夹会报错，只用来对照样式
import { createApp, h, reactive, ref } from 'vue'
import '../src/style.css'
import SettingsPage from '../src/pages/SettingsPage.vue'
import LibraryPage from '../src/pages/LibraryPage.vue'
import NotePage from '../src/pages/NotePage.vue'
import { installLibraryShell } from './library'
import CollectPage from '../src/pages/CollectPage.vue'
import ProcessingView from '../src/components/ProcessingView.vue'
import SavedView from '../src/components/SavedView.vue'
import TitleBar from '../src/components/TitleBar.vue'
import ToastHost from '../src/components/ToastHost.vue'
import { defaultConfig } from '../src/core/config'
import { DEFAULT_PROMPTS } from '../src/core/defaultPrompts'
import { newJob } from '../src/core/pipeline'
import { toDraft } from '../src/core/draft'
import { keyId, type UsageRecord } from '../src/core/cost'

const query = new URLSearchParams(location.search)
const p = query.get('p')
const config = defaultConfig()
// ?keys=1 假装三项服务都填好了（看“内容较长”这类要点开始才出现的提示）
if (query.get('keys')) for (const k of ['text', 'vision', 'asr'] as const) config.services[k].apiKey = 'sk-test'

// ?p=settings&vault=obsidian|pick|none|folder：假装电脑上有两个 Obsidian 仓库，看收藏库卡片（F31）；pick 是刚切到 Obsidian、还没选仓库，none 是电脑上没有仓库
const vaultDemo = query.get('vault')
if (vaultDemo) {
  const vaults =
    vaultDemo === 'none'
      ? []
      : [
          { name: '我的笔记', path: 'D:\\Obsidian\\我的笔记' },
          { name: '工作库', path: 'D:\\工作\\工作库' },
        ]
  config.vaultPath = vaultDemo === 'obsidian' ? vaults[0].path : 'D:\\测试收藏库'
  config.vault = { kind: vaultDemo === 'folder' ? 'folder' : 'obsidian', subfolder: '收藏' }
  const folders = ['工作', '收藏', '收藏/抖音', '读书']
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: { path?: string; sub?: string }) => {
        if (cmd === 'list_obsidian_vaults') return vaults
        if (cmd === 'list_subfolders') return [...folders].sort()
        if (cmd === 'ensure_subfolder') return void folders.push(args!.sub!) // 假装建好了
        if (cmd === 'dir_exists') return vaults.some((v) => args?.path === `${v.path}\\.obsidian`)
        throw new Error('预览里没有外壳')
      },
    },
  })
}

// ?p=settings&domain=6：删除领域预览，只操作假数据，不读写收藏库。
if (p === 'settings' && query.has('domain')) {
  config.vaultPath = 'D:\\测试收藏库'
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string) => {
        if (cmd === 'count_domain_notes') return Number(query.get('domain'))
        if (cmd === 'delete_domain') return { images: [] }
        if (cmd === 'restore_domain' || cmd === 'save_config') return
        throw new Error('预览里没有外壳')
      },
    },
  })
}

// ?p=settings&usage=1：假装填了密钥、用过一阵，看设置页每把密钥的花费
if (query.has('usage')) {
  config.services.text.apiKey = config.services.vision.apiKey = 'sk-demo'
  config.services.asr.apiKey = 'sk-asr'
  const rec = async (key: string, service: UsageRecord['service'], cost: number, time = new Date()) => ({
    time: time.toISOString(),
    service,
    model: '',
    keyId: await keyId(key),
    cost,
  })
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string) => {
        if (cmd === 'save_config') return // 假装存好了
        if (cmd !== 'usage_read') throw new Error('预览里没有外壳')
        const rs = [
          await rec('sk-demo', 'text', 0.85, new Date('2026-09-15')),
          ...(await Promise.all(Array.from({ length: 41 }, () => rec('sk-demo', 'text', 0.35 / 41)))),
          ...(await Promise.all(Array.from({ length: 40 }, () => rec('sk-asr', 'asr', 0)))),
        ]
        return rs.map((r) => JSON.stringify(r)).join('\n')
      },
    },
  })
}

// 处理中预览用的长一点的文字，能看到打满一框后往上滚
const SAMPLE_TEXT =
  '商务礼仪三重点：摆正位置、端正态度、分清场合\n商务礼仪的三个重点是摆正位置、端正态度、分清场合。\n摆正位置\n尊重上级是天职，尊重平级是本分，尊重下级是美德。\n一提到尊重领导、尊重上级就排斥反感，这是没有摆正位置。'

const LONG_TEXT = [SAMPLE_TEXT, SAMPLE_TEXT, SAMPLE_TEXT].join('\n')

function procView() {
  const job = reactive(newJob('商务礼仪.mp4', '视频', '要点提炼'))
  const t0 = Date.now()
  job.steps[0] = { ...job.steps[0], status: 'done', startedAt: t0 - 4000, endedAt: t0 }
  const failed = query.has('failed')
  if (query.has('typing') || failed) {
    job.steps[1] = { ...job.steps[1], status: 'done', startedAt: t0 - 28000, endedAt: t0 }
    job.steps[2] = { ...job.steps[2], status: failed ? 'failed' : 'running', startedAt: t0 }
    // 模拟 AI 一段一段地返回
    let n = 0
    const timer = setInterval(() => {
      n = Math.min(LONG_TEXT.length, n + 6)
      job.preview = LONG_TEXT.slice(0, n)
      if (n >= LONG_TEXT.length || failed) clearInterval(timer)
    }, 120)
  } else {
    job.steps[1] = { ...job.steps[1], status: 'running', startedAt: t0 }
  }
  const now = ref(Date.now())
  setInterval(() => (now.value = Date.now()), 500)
  return () =>
    h('main', { class: 'page', style: 'max-width:820px;margin:0 auto;padding:48px 20px' }, [
      h(ProcessingView, {
        job,
        failed,
        summary: { name: '商务礼仪.mp4', info: '13.5 MB · 3:01 · 要点提炼' },
        error: failed ? { code: 'network', message: '网络连接失败，请检查网络和接口地址后重试' } : null,
        now: now.value,
      }),
    ])
}

const savedView = () =>
  h('main', { class: 'page', style: 'max-width:820px;margin:0 auto;padding:48px 20px' }, [
    h(SavedView, {
      note: {
        path: '为人处世/商务礼仪三重点：摆正位置、端正态度、分清场合.md',
        failedImages: query.has('imgfail') ? ['第 2 张'] : [],
        title: '商务礼仪三重点：摆正位置、端正态度、分清场合',
        summary: '商务礼仪的三个重点是摆正位置、端正态度、分清场合：尊重上级、态度会像镜子一样回馈自己。',
        text:
          SAMPLE_TEXT.split('\n').slice(1).join('\n') +
          '\n态度不端正，影响的不只是职业发展。\n分清场合\n有人觉得出去一直守规矩很别扭。',
      },
      location: '测试收藏库',
      openError: null,
      cost: 0.0123,
    }),
  ])

if (p === 'library' || p === 'note') {
  config.vaultPath = 'D:/测试收藏库'
  if (query.get('obs')) config.vault = { ...config.vault, kind: 'obsidian' } // ?p=note&obs=1 连的是 Obsidian：显示“在 Obsidian 中打开”
  installLibraryShell(p === 'note' ? query.get('note') : query.get('lib'))
  // &view=list 列表显示（收藏库页把显示方式记在 localStorage）
  localStorage.setItem('library-view', query.get('view') === 'list' ? 'list' : 'grid')
}

const body =
  p === 'library'
    ? () => h(LibraryPage, { config })
    : p === 'note'
      ? () => h(NotePage, { config, path: '设计UI/Dribbble 卡片式仪表盘的配色和布局-2.md' })
      : p === 'saved'
        ? savedView
        : p === 'settings'
          ? () => h(SettingsPage, { config, firstRun: true })
          : p === 'proc'
            ? procView()
            : () => h(CollectPage, { config, prompts: DEFAULT_PROMPTS })

// ?drop=draft：假装上次留下一条整理完没保存的草稿，看投放页最上面那行提示
if (query.get('drop') === 'draft') {
  const job = newJob('敬酒礼仪.mp4', '视频', '要点提炼')
  job.steps.forEach((s) => (s.status = 'done'))
  job.transcript = SAMPLE_TEXT
  job.draft = { title: '敬酒礼仪', domainId: 1, tags: [], keywords: [], summary: '', body: '正文', image_captions: [] }
  const json = new TextEncoder().encode(JSON.stringify(toDraft(job).data))
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string) => {
        if (cmd === 'draft_list') return ['draft.json']
        if (cmd === 'draft_read') return json.buffer
        throw new Error('预览里没有外壳')
      },
    },
  })
}

createApp({
  render: () => [
    h(TitleBar, {
      page: p === 'settings' ? 'settings' : p === 'library' || p === 'note' ? 'library' : 'home',
      onlySettings: false,
    }),
    body(),
    h(ToastHost),
  ],
}).mount('#app')

// 逐帧检查设置页的切换动画：点开指定卡片，动画停在指定的毫秒（可加 &from=卡片id 先展开另一张）
// 收藏库卡片的抽出动画：?p=library&hover=第几张 放上去停稳的样子；
// &sweep=1 模拟鼠标快速来回（第 2 张：放上去 / 移开各 100ms，来回 4 次），每一帧记下抽出程度，
// 在左上角画成曲线：曲线连续、反向处是圆滑的弯而不是折角或平台，就说明快速来回不会顿住
const hover = query.get('hover')
if (hover || query.has('sweep')) {
  const wait = (t: number) => new Promise((r) => setTimeout(r, t))
  setTimeout(async () => {
    const card = document.querySelectorAll<HTMLElement>('.note-card, .note-row')[hover ? Number(hover) - 1 : 1]
    const enter = () => card.dispatchEvent(new PointerEvent('pointerenter'))
    const leave = () => card.dispatchEvent(new PointerEvent('pointerleave'))
    if (hover) return enter()
    const samples: number[] = []
    const times: number[] = []
    let on = true
    const record = () => {
      // 抽出程度：方块 = 上层下移距离 ÷ 卡片高度的 27%（NoteCard 的 MOVE）；列表 = 淡灰底的不透明度（NoteRow 里等于抽出程度，到 1 为止，看不到回弹）
      const num = (el: HTMLElement, re: RegExp) => Number(re.exec(el.style.transform)?.[1] ?? 0)
      const front = card.querySelector<HTMLElement>('.front')
      samples.push(
        front
          ? num(front, /translateY\(([-\d.]+)px\)/) / (card.querySelector('.clip')!.clientHeight * 0.27)
          : Number(card.querySelector<HTMLElement>('.bg')!.style.opacity || 0),
      )
      times.push(performance.now())
      if (on) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
    for (let i = 0; i < 4; i++) {
      enter()
      await wait(100)
      leave()
      await wait(100)
    }
    enter()
    await wait(700)
    on = false
    const W = 600
    const H = 160
    const t0 = times[0]
    const span = times[times.length - 1] - t0
    const pts = samples.map((v, i) => `${((times[i] - t0) / span) * W},${H - 20 - v * (H - 40)}`).join(' ')
    // 换算成每 16ms（一帧）变了多少，帧间隔不均匀时也能比较
    const maxStep = Math.max(
      ...samples.slice(1).map((v, i) => (Math.abs(v - samples[i]) / Math.max(times[i + 1] - times[i], 1)) * 16),
    )
    const maxGap = Math.max(...times.slice(1).map((t, i) => t - times[i]))
    const box = document.createElement('div')
    box.style.cssText =
      'position:fixed;top:0;left:0;z-index:99;background:#fff;border:1px solid #888;font:12px sans-serif'
    box.innerHTML = `<svg width="${W}" height="${H}"><line x1="0" x2="${W}" y1="${H - 20 - (H - 40)}" y2="${H - 20 - (H - 40)}" stroke="#ccc"/><line x1="0" x2="${W}" y1="${H - 20}" y2="${H - 20}" stroke="#ccc"/><polyline fill="none" stroke="#5b5bd6" stroke-width="2" points="${pts}"/></svg><div>${samples.length} 帧，每 16ms 最多变 ${maxStep.toFixed(3)}，最长帧间隔 ${maxGap.toFixed(0)}ms，最大值 ${Math.max(...samples).toFixed(3)}</div>`
    document.body.append(box)
  }, 1000)
}

const freeze = query.get('freeze')
if (freeze) {
  const [id, ms] = freeze.split(':')
  const click = (cid: string) =>
    document
      .querySelector<HTMLElement>(`[data-card=${cid}] input, [data-card=${cid}] .path, [data-card=${cid}] li`)
      ?.click()
  setTimeout(async () => {
    const from = query.get('from')
    if (from) {
      click(from)
      await new Promise((r) => setTimeout(r, 30))
      document.getAnimations().forEach((a) => a.finish())
      await new Promise((r) => setTimeout(r, 400))
    }
    click(id)
    await new Promise((r) => setTimeout(r, 20))
    document.getAnimations().forEach((a) => {
      a.pause()
      a.currentTime = Number(ms)
    })
  }, 500)
}

// 投放页的几种样子：?drop=video 放视频并粘贴分享文字、images 放两张截图、txt 放 GBK 的 txt 并写本次要求、bad 放认不出编码的 txt
const drop = query.get('drop')
if (drop) {
  const put = (files: File[]) => {
    const dt = new DataTransfer()
    files.forEach((f) => dt.items.add(f))
    document.querySelector('.card')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
  }
  const sample = async (name: string, type: string) =>
    new File([await (await fetch(`/samples/${name}`)).blob()], name, { type })
  const type = (sel: string, text: string, paste = false) => {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!
    if (paste) {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    } else {
      el.value = text
      el.dispatchEvent(new Event('input'))
    }
  }
  setTimeout(async () => {
    if (drop === 'video') {
      put([await sample('商务礼仪.mp4', 'video/mp4')])
      await new Promise((r) => setTimeout(r, 100))
      type(
        '.link-input input',
        '7.53 复制打开抖音，看看【礼仪老师小王的作品】商务礼仪三重点 # 商务礼仪  https://v.douyin.com/iAbC123/ Xzm:/',
        true,
      )
    } else if (drop === 'images') {
      put([await sample('网页滚动动画.png', 'image/png'), await sample('会议幻灯片.png', 'image/png')])
    } else if (drop === 'txt') {
      // “会议记录：决定下周上线” 的 GBK 编码，重复几遍
      const gbk = 'BBE1D2E9BCC7C2BCA3BABEF6B6A8CFC2D6DCC9CFCFDF'
      const bytes = new Uint8Array(gbk.match(/../g)!.map((x) => parseInt(x, 16)))
      put([new File(Array(40).fill(bytes), '会议记录.txt', { type: 'text/plain' })])
      await new Promise((r) => setTimeout(r, 100))
      type('.textarea textarea', '只保留决定事项和负责人')
    } else if (drop === 'bad') {
      put([new File([new Uint8Array(300).map((_, i) => (i * 37 + 129) % 256)], '旧笔记.txt', { type: 'text/plain' })])
    }
  }, 300)
}

// ?p=settings&vault=obsidian&selecttest=1：在没展开的收藏库卡片里点开“存到哪个文件夹”下拉框，等卡片展开完，
// 把列表上边和按钮下边的距离显示在左上角（用 Edge 截图看，0～4 是贴着按钮；几百是没跟上卡片展开）
if (query.has('selecttest')) {
  setTimeout(async () => {
    document.querySelector<HTMLElement>('button[aria-label="存放文件夹"]')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    const btn = document.querySelector('button[aria-label="存放文件夹"]')!.getBoundingClientRect()
    const menu = document.querySelector('[role=listbox]')?.getBoundingClientRect()
    const out = document.createElement('output')
    out.style.cssText = 'position:fixed;top:0;left:0;z-index:99;padding:8px;background:#ff0;font-size:20px'
    out.textContent = `列表离按钮 ${menu ? Math.round(menu.top - btn.bottom) : '没有打开'}`
    document.body.append(out)
  }, 800)
}

// ?p=settings&vault=obsidian&foldertest=input|done：自动选“新建文件夹…”、填“剪藏”，input 停在填好的样子，done 再点「新建」
const folderTest = query.get('foldertest')
if (folderTest) {
  setTimeout(async () => {
    const wait = (t: number) => new Promise((r) => setTimeout(r, t))
    document.querySelector<HTMLElement>('button[aria-label="存放文件夹"]')?.click()
    await wait(1200)
    ;[...document.querySelectorAll<HTMLElement>('[role=option]')].find((e) => e.textContent?.includes('新建'))?.click()
    await wait(100)
    const i = document.querySelector<HTMLInputElement>('input[aria-label="新文件夹的名字"]')!
    i.value = '剪藏'
    i.dispatchEvent(new Event('input'))
    await wait(100)
    if (folderTest === 'done') [...document.querySelectorAll<HTMLElement>('.new-folder button')].at(-1)?.click()
  }, 800)
}

// ?p=settings&usage=1&pricetest=1：自动展开文字整理的价格、填 2、点确定，看收起后浮起的保存条
if (query.has('pricetest')) {
  setTimeout(async () => {
    const wait = (t: number) => new Promise((r) => setTimeout(r, t))
    document.querySelector<HTMLElement>('[data-card=services] input')?.click()
    await wait(600)
    document.querySelector<HTMLElement>('.price-toggle')?.click()
    await wait(100)
    const i = document.querySelector<HTMLInputElement>('.price input')!
    i.value = '2'
    i.dispatchEvent(new Event('input'))
    await wait(100)
    document.querySelector<HTMLElement>('.price-actions .primary')?.click() // 完成：只收起，保存条浮起来
  }, 800)
}

// ?p=settings&usage=1&savetest=1：改一个字、点底部“保存设置”，看保存条左边的“已保存”
if (query.has('savetest')) {
  setTimeout(async () => {
    const wait = (t: number) => new Promise((r) => setTimeout(r, t))
    const i = document.querySelector<HTMLInputElement>('[data-card=services] input')!
    i.value += '/'
    i.dispatchEvent(new Event('input'))
    await wait(100)
    const btn = document.querySelector<HTMLButtonElement>('.save-bar .primary')!
    const disabledBeforeClick = btn.disabled
    btn.click()
    await wait(300)
    // 写进页面，无界面浏览器用 --dump-dom 读
    document.body.dataset.result = JSON.stringify({
      disabledBeforeClick,
      afterSave: document.querySelector<HTMLElement>('.save-bar')?.innerText,
    })
  }, 800)
}
