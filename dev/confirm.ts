// 确认页预览（只在开发时用：npx vite 后打开 /dev/confirm.html）。
// 用固定的示例内容渲染确认页，改样式时对照看；地址加 ?source=1 时直接切到原文对照，
// 再加 &link=1 时自动点正文第二个小标题下的第一条，显示原文定位和连线（截图用）
import { createApp, h, nextTick } from 'vue'
import '../src/style.css'
import ConfirmPage from '../src/pages/ConfirmPage.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { SAMPLE_JOB, SAMPLE_EXISTING_TAGS } from './sample'

createApp({
  render: () => [
    h(TitleBar, { page: 'home', homeDisabled: false }),
    h(ConfirmPage, { config: defaultConfig(), job: SAMPLE_JOB, existingTags: SAMPLE_EXISTING_TAGS }),
  ],
}).mount('#app')

const query = new URLSearchParams(location.search)
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
