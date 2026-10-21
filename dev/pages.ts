// 设置页、投放页预览（只在开发时用：npx vite 后打开 /dev/pages.html，加 ?p=settings 看设置页）。
// 不连外壳，点保存、选文件夹会报错，只用来对照样式
import { createApp, h } from 'vue'
import '../src/style.css'
import SettingsPage from '../src/pages/SettingsPage.vue'
import CollectPage from '../src/pages/CollectPage.vue'
import TitleBar from '../src/components/TitleBar.vue'
import { defaultConfig } from '../src/core/config'
import { DEFAULT_PROMPTS } from '../src/core/defaultPrompts'

const settings = new URLSearchParams(location.search).get('p') === 'settings'
const config = defaultConfig()

createApp({
  render: () => [
    h(TitleBar, { page: settings ? 'settings' : 'home', homeDisabled: false }),
    settings ? h(SettingsPage, { config, firstRun: true }) : h(CollectPage, { config, prompts: DEFAULT_PROMPTS }),
  ],
}).mount('#app')
