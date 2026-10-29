// 确认页预览（只在开发时用：npx vite 后打开 /dev/confirm.html）。
// 用固定的示例内容渲染确认页，改样式时对照看；地址加 ?source=1 时直接切到原文对照，
// 再加 &link=1 时自动点正文第二个小标题下的第一条，显示原文定位和连线（截图用）；
// ?image=1 用自绘读书笔记流程图看视觉收藏，再加 &crop=1 直接打开调整裁剪
// ?savefail=1 模拟保存失败（见文件末尾）
import { createApp, h, nextTick, reactive } from 'vue'
import '../src/style.css'
import ConfirmPage from '../src/pages/ConfirmPage.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { newImageJob, type Job } from '../src/core/pipeline'
import { autoCrop, readPixels } from '../src/core/image'
import { SAMPLE_JOB, SAMPLE_EXISTING_TAGS, SAMPLE_IMAGE_DRAFT } from './sample'

const query = new URLSearchParams(location.search)

async function imageJob(): Promise<Job> {
  const blob = await (await fetch('/assets/reading-notes.svg')).blob()
  const job = newImageJob([new File([blob], '读书笔记流程.svg', { type: 'image/svg+xml' })], '视觉收藏')
  job.draft = SAMPLE_IMAGE_DRAFT
  job.source = 'https://example.com/reading-notes'
  const img = job.images![0]
  img.autoCrop = img.crop = autoCrop(await readPixels(img.file), [0, 0.12, 1, 0.76])
  return job
}

const job = query.has('image') ? await imageJob() : SAMPLE_JOB
const config = defaultConfig()
config.vaultPath = 'D:/演示收藏库'
config.domains.unshift({ id: 1, name: '学习阅读' })
createApp({
  render: () => [
    h(TitleBar, { page: 'home', onlySettings: false }),
    h(ConfirmPage, {
      config,
      job: reactive(job),
      existingTags: SAMPLE_EXISTING_TAGS,
    }),
  ],
}).mount('#app')

if (query.has('crop'))
  void nextTick(() => setTimeout(() => document.querySelector<HTMLButtonElement>('.pic-tools button')?.click(), 500))
if (query.has('source')) {
  void nextTick(() => {
    document.querySelector<HTMLButtonElement>('.tab')?.click()
    if (query.has('link'))
      setTimeout(
        () => document.querySelectorAll<HTMLElement>('.tiptap > ul')[1]?.querySelector<HTMLElement>('li p')?.click(),
        800,
      )
  })
}
// ?savefail=1 模拟收藏库文件夹找不到时点保存，看失败提示框；再加 &closed=1 关掉提示框，看按钮上方那一行
if (query.has('savefail')) {
  Object.assign(window, {
    __TAURI_INTERNALS__: { invoke: () => Promise.reject('收藏库文件夹“D:\\笔记\\收藏库”找不到了，请重新选择') },
  })
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>('.action-row .btn-primary')?.click()
    if (query.has('closed'))
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 300)
  }, 600)
}
