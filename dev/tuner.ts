// 设计调节页（只在开发时用：npx vite 后打开 /dev/tuner.html）。
// 真实的确认页 + 右下角的调节面板，用来挑选设计令牌（设计规范第 0.1 节第②步）
import { createApp, h } from 'vue'
import '../src/style.css'
import ConfirmPage from '../src/pages/ConfirmPage.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { SAMPLE_JOB, SAMPLE_EXISTING_TAGS } from './sample'
import TunerPanel from './TunerPanel.vue'

createApp({
  render: () => [
    h(TitleBar, { page: 'home', homeDisabled: false }),
    h(ConfirmPage, { config: defaultConfig(), job: SAMPLE_JOB, existingTags: SAMPLE_EXISTING_TAGS }),
    h(TunerPanel),
  ],
}).mount('#app')
