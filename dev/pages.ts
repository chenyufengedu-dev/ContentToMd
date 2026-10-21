// 设置页、投放页预览（只在开发时用：npx vite 后打开 /dev/pages.html）。
// ?p=settings 设置页；?p=proc 处理中（出字前），&typing=1 模拟逐字生成，&failed=1 处理失败。
// 不连外壳，点保存、选文件夹会报错，只用来对照样式
import { createApp, h, reactive, ref } from 'vue'
import '../src/style.css'
import SettingsPage from '../src/pages/SettingsPage.vue'
import CollectPage from '../src/pages/CollectPage.vue'
import ProcessingView from '../src/components/ProcessingView.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { DEFAULT_PROMPTS } from '../src/core/defaultPrompts'
import { newJob } from '../src/core/pipeline'

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

const body =
  p === 'settings'
    ? () => h(SettingsPage, { config, firstRun: true })
    : p === 'proc'
      ? procView()
      : () => h(CollectPage, { config, prompts: DEFAULT_PROMPTS })

createApp({
  render: () => [h(TitleBar, { page: p === 'settings' ? 'settings' : 'home', homeDisabled: false }), body()],
}).mount('#app')
