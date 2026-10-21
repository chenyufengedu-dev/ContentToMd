// 设置页、投放页预览（只在开发时用：npx vite 后打开 /dev/pages.html）。
// ?p=settings 设置页（&freeze=卡片id:毫秒 点开这张卡片并把动画停在第几毫秒，逐帧检查动画用）；?p=proc 处理中（出字前），&typing=1 模拟逐字生成，&failed=1 处理失败；?p=saved 保存成功，&imgfail=1 有图片没写入。；?drop=video|images|txt|bad|draft 投放页放入内容后的样子。
// 不连外壳，点保存、选文件夹会报错，只用来对照样式
import { createApp, h, reactive, ref } from 'vue'
import '../src/style.css'
import SettingsPage from '../src/pages/SettingsPage.vue'
import CollectPage from '../src/pages/CollectPage.vue'
import ProcessingView from '../src/components/ProcessingView.vue'
import SavedView from '../src/components/SavedView.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { DEFAULT_PROMPTS } from '../src/core/defaultPrompts'
import { newJob } from '../src/core/pipeline'
import { toDraft } from '../src/core/draft'

const query = new URLSearchParams(location.search)
const p = query.get('p')
const config = defaultConfig()

const SAMPLE_TEXT =
  '商务礼仪三重点：摆正位置、端正态度、分清场合\n商务礼仪的三个重点是摆正位置、端正态度、分清场合。\n摆正位置\n尊重上级是天职，尊重平级是本分，尊重下级是美德。\n一提到尊重领导、尊重上级就排斥反感，这是没有摆正位置。'

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
      n = Math.min(SAMPLE_TEXT.length, n + 6)
      job.preview = SAMPLE_TEXT.slice(0, n)
      if (n >= SAMPLE_TEXT.length || failed) clearInterval(timer)
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
      vaultName: '收藏库',
      openError: null,
    }),
  ])

const body =
  p === 'saved'
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
  render: () => [h(TitleBar, { page: p === 'settings' ? 'settings' : 'home', homeDisabled: false }), body()],
}).mount('#app')

// 逐帧检查设置页的切换动画：点开指定卡片，动画停在指定的毫秒（可加 &from=卡片id 先展开另一张）
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
