// 确认页预览（只在开发时用：npx vite 后打开 /dev/confirm.html）。
// 用固定的示例内容渲染确认页，改样式时对照看；地址加 ?source=1 时直接打开原文抽屉
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

if (new URLSearchParams(location.search).has('source')) {
  void nextTick(() => document.querySelector<HTMLButtonElement>('.compare-btn')?.click())
}
