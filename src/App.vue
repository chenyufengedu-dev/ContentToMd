<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { type Config, parseConfig, isConfigComplete, notesRoot } from './core/config'
import { loadConfigJson, dirExists, ensurePrompts } from './shell/tauri'
import type { Prompts } from './core/note'
import { DEFAULT_PROMPTS } from './core/defaultPrompts'
import SettingsPage from './pages/SettingsPage.vue'
import CollectPage from './pages/CollectPage.vue'
import TitleBar, { type Page } from './components/TitleBar.vue'
import LibraryPage from './pages/LibraryPage.vue'
import NotePage from './pages/NotePage.vue'
import NoticeDialog from './components/NoticeDialog.vue'

const config = ref<Config | null>(null)
const prompts = ref<Prompts | null>(null)
const page = ref<Page>('home')
const firstRun = ref(false)
const loadError = ref<string | null>(null)
const vaultMissing = ref(false)

// ---- 收藏库里打开的笔记（F22）：笔记页盖在收藏库页上面，收藏库页留着，回来时筛选和滚动位置都在 ----
const notePath = ref<string | null>(null)
const noteDirty = ref(false)
const library = ref<InstanceType<typeof LibraryPage>>()
function closeNote(changed: boolean) {
  notePath.value = null
  noteDirty.value = false
  if (changed) void library.value?.load()
}
/** 标题栏点别的页：笔记有改动没保存时先问；点“收藏库”回到列表 */
const pendingPage = ref<Page | null>(null)
function navigate(p: Page) {
  if (notePath.value && noteDirty.value) {
    pendingPage.value = p
    return
  }
  if (notePath.value && p === 'library') closeNote(false)
  page.value = p
}
function leaveNote() {
  const p = pendingPage.value
  pendingPage.value = null
  closeNote(false)
  if (p) page.value = p
}

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
    vaultMissing.value = !(await dirExists(notesRoot(config.value)))
  }
})

async function onSaved(c: Config) {
  config.value = c
  if (isConfigComplete(c)) {
    firstRun.value = false
    vaultMissing.value = !(await dirExists(notesRoot(c)))
  }
}
</script>

<template>
  <p v-if="loadError" class="fatal">启动失败，无法读取配置或整理指令：{{ loadError }}</p>
  <template v-else-if="config">
    <TitleBar :page="page" :only-settings="firstRun" @navigate="navigate" />
    <!-- 标题栏下面的内容区自己滚动，整个窗口不出滚动条，标题栏的宽度和位置就不会跟着页面变 -->
    <div class="app-body">
      <template v-if="page === 'library'">
        <LibraryPage
          v-show="!notePath"
          ref="library"
          :config="config"
          @go-home="page = 'home'"
          @go-settings="page = 'settings'"
          @open="(p) => (notePath = p)"
        />
        <NotePage
          v-if="notePath"
          ref="notePage"
          :key="notePath"
          :config="config"
          :path="notePath"
          @back="closeNote"
          @dirty="(v) => (noteDirty = v)"
          @go-settings="page = 'settings'"
          @config-changed="(c) => (config = c)"
        />
      </template>
      <SettingsPage v-if="page === 'settings'" :config="config" :first-run="firstRun" @saved="onSaved" />
      <div v-show="page === 'home'">
        <p v-if="vaultMissing" class="fatal">收藏库文件夹“{{ notesRoot(config) }}”找不到了，请到设置里重新选择。</p>
        <CollectPage
          v-if="prompts && !firstRun"
          :config="config"
          :prompts="prompts"
          @go-settings="page = 'settings'"
          @config-changed="(c) => (config = c)"
        />
      </div>
    </div>
    <NoticeDialog
      v-if="pendingPage"
      title="有修改还没保存"
      cancel-text="继续编辑"
      ok-text="不保存，离开"
      @cancel="pendingPage = null"
      @ok="leaveNote"
    >
      <p>现在离开，这些修改会丢掉。</p>
    </NoticeDialog>
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
