// 确认页预览（只在开发时用：npx vite 后打开 /dev/confirm.html）。
// 用固定的示例内容渲染确认页，改样式时对照看；地址加 ?source=1 时直接切到原文对照，
// 再加 &link=1 时自动点正文第二个小标题下的第一条，显示原文定位和连线（截图用）；
// ?image=1 用 samples/网页滚动动画.png 看视觉收藏（按一个假的 AI 主体区域自动裁剪），再加 &crop=1 直接打开调整裁剪
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
  const blob = await (await fetch('/samples/网页滚动动画.png')).blob()
  const job = newImageJob([new File([blob], '网页滚动动画.png', { type: 'image/png' })], '视觉收藏')
  job.draft = SAMPLE_IMAGE_DRAFT
  job.source = 'https://www.xiaohongshu.com/explore/xxxx'
  const img = job.images![0]
  img.autoCrop = img.crop = autoCrop(await readPixels(img.file), [0, 0.12, 1, 0.76])
  return job
}

const job = query.has('image') ? await imageJob() : SAMPLE_JOB
createApp({
  render: () => [
    h(TitleBar, { page: 'home', homeDisabled: false }),
    h(ConfirmPage, { config: defaultConfig(), job: reactive(job), existingTags: SAMPLE_EXISTING_TAGS }),
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
