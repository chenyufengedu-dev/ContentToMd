<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { type Config, parseConfig, isConfigComplete } from './core/config'
import { loadConfigJson, dirExists, ensurePrompts } from './shell/tauri'
import type { Prompts } from './core/note'
import { DEFAULT_PROMPTS } from './core/defaultPrompts'
import SettingsPage from './pages/SettingsPage.vue'
import CollectPage from './pages/CollectPage.vue'
import TitleBar from './components/TitleBar.vue'

const config = ref<Config | null>(null)
const prompts = ref<Prompts | null>(null)
const page = ref<'home' | 'settings'>('home')
const firstRun = ref(false)
const loadError = ref<string | null>(null)
const vaultMissing = ref(false)

onMounted(async () => {
  try {
    config.value = parseConfig(await loadConfigJson())
    prompts.value = (await ensurePrompts(DEFAULT_PROMPTS)) as Prompts
  } catch (e) {
    loadError.value = String(e) // 配置或指令文件读取失败
    return
  }
  // 还没配置完时直接进入设置页（方案第 6.3 节）
  if (!isConfigComplete(config.value)) {
    firstRun.value = true
    page.value = 'settings'
  } else {
    vaultMissing.value = !(await dirExists(config.value.vaultPath))
  }
})

async function onSaved(c: Config) {
  config.value = c
  if (isConfigComplete(c)) {
    firstRun.value = false
    vaultMissing.value = !(await dirExists(c.vaultPath))
  }
}
</script>

<template>
  <p v-if="loadError" class="fatal">启动失败，无法读取配置或整理指令：{{ loadError }}</p>
  <template v-else-if="config">
    <TitleBar :page="page" :home-disabled="firstRun" @navigate="(p) => (page = p)" />
    <!-- 标题栏下面的内容区自己滚动，整个窗口不出滚动条，标题栏的宽度和位置就不会跟着页面变 -->
    <div class="app-body">
      <SettingsPage v-if="page === 'settings'" :config="config" :first-run="firstRun" @saved="onSaved" />
      <div v-show="page === 'home'">
        <p v-if="vaultMissing" class="fatal">收藏库文件夹“{{ config.vaultPath }}”找不到了，请到设置里重新选择。</p>
        <CollectPage v-if="prompts && !firstRun" :config="config" :prompts="prompts" @go-settings="page = 'settings'" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.app-body {
  height: calc(100vh - var(--titlebar-h));
  overflow-y: auto;
}
.fatal {
  color: var(--err);
  padding: var(--sp-5);
}
</style>
