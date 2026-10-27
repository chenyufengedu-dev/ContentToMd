<script setup lang="ts">
import { UNSAVED_CHANGES, LEAVE_CHANGES_WARNING } from './core/editMessages'
import { onMounted, ref } from 'vue'
import { vPageFade } from './components/pageFade'
import { type Config, parseConfig, notesRoot } from './core/config'
import {
  listEditRecoveries,
  loadConfigJson,
  dirExists,
  ensurePrompts,
  restoreNote,
  loadOnboarding,
  saveOnboarding,
} from './shell/tauri'
import type { Prompts } from './core/note'
import { DEFAULT_PROMPTS } from './core/defaultPrompts'
import { RECOVERY_CLEAR_ERROR } from './core/noteRecovery'
import OnboardingPage from './pages/OnboardingPage.vue'
import WelcomeCelebration from './components/WelcomeCelebration.vue'
import SettingsPage from './pages/SettingsPage.vue'
import CollectPage from './pages/CollectPage.vue'
import TitleBar, { type Page } from './components/TitleBar.vue'
import LibraryPage from './pages/LibraryPage.vue'
import NotePage from './pages/NotePage.vue'
import NoticeDialog from './components/NoticeDialog.vue'
import UnsavedDialog from './components/UnsavedDialog.vue'
import ToastHost from './components/ToastHost.vue'
import { toast } from './components/useToast'

const config = ref<Config | null>(null)
const prompts = ref<Prompts | null>(null)
const page = ref<Page>('home')
const showOnboarding = ref(false)
const onboardingState = ref({ finished: false, celebrated: false })
const celebrationPending = ref(false)
const loadError = ref<string | null>(null)
const vaultMissing = ref(false)

// ---- 收藏库里打开的笔记（F22）：笔记页盖在收藏库页上面，收藏库页留着，回来时筛选和滚动位置都在 ----
const notePath = ref<string | null>(null)
const noteDirty = ref(false)
const library = ref<InstanceType<typeof LibraryPage>>()
const notePage = ref<InstanceType<typeof NotePage>>()
function closeNote(changed: boolean) {
  notePath.value = null
  noteDirty.value = false
  if (changed) void library.value?.load()
}
/** 笔记删除了：回到收藏库，提示条上给「撤销」（从回收站还原笔记和图片） */
function onNoteDeleted(info: { path: string; images: string[] }) {
  closeNote(true)
  const n = info.images.length
  toast(`已移入回收站：笔记${n ? `及 ${n} 张图片` : ''}。`, {
    action: {
      label: '撤销',
      run: async () => {
        try {
          await restoreNote(notesRoot(config.value!), info.path, info.images)
          toast('笔记已恢复。')
          void library.value?.load()
        } catch (e) {
          const msg = String(e)
          toast(`撤销失败：${msg.endsWith('。') ? msg : `${msg}。`}`, { kind: 'error' })
        }
      },
    },
  })
}
/** 保存成功页的「打开文档」：进收藏库里这条笔记的笔记页 */
function openSavedNote(path: string) {
  page.value = 'library'
  notePath.value = path
}
/** 标题栏点别的页：笔记有改动没保存时先问；点“收藏库”回到列表 */
const pendingPage = ref<Page | null>(null)
/** 设置页有没保存的改动：切换页面前问“保存 / 放弃更改 / 取消” */
const settings = ref<InstanceType<typeof SettingsPage>>()
const settingsPending = ref(false)
const settingsDomainBusy = ref(false)
const askSettings = ref<Page | null>(null)
const savingSettings = ref(false)
async function saveSettingsAndGo() {
  const to = askSettings.value
  savingSettings.value = true
  const ok = await settings.value?.save()
  savingSettings.value = false
  askSettings.value = null
  if (ok && to) {
    settingsPending.value = false
    navigate(to)
  } // 没存成就留在设置页，保存条上写着原因
}
function discardSettingsAndGo() {
  const to = askSettings.value
  askSettings.value = null
  settingsPending.value = false
  if (to) navigate(to)
}
function navigate(p: Page) {
  if (page.value === 'settings' && p !== 'settings' && settingsDomainBusy.value) {
    toast('领域操作尚未完成，请稍后切换。', { kind: 'error' })
    return
  }
  if (page.value === 'settings' && p !== 'settings' && settingsPending.value) {
    askSettings.value = p
    return
  }
  if (notePath.value && noteDirty.value) {
    pendingPage.value = p
    return
  }
  if (notePath.value && p === 'library') closeNote(false)
  page.value = p
}
async function leaveNote() {
  if (!(await notePage.value?.discardEdits())) {
    pendingPage.value = null
    toast(RECOVERY_CLEAR_ERROR, { kind: 'error' })
    return
  }
  const p = pendingPage.value
  pendingPage.value = null
  closeNote(false)
  if (p) page.value = p
}

onMounted(async () => {
  try {
    const json = await loadConfigJson()
    const loadedConfig = parseConfig(json)
    onboardingState.value = await loadOnboarding()
    showOnboarding.value = json === null && !onboardingState.value.finished
    prompts.value = (await ensurePrompts(DEFAULT_PROMPTS)) as Prompts
    config.value = loadedConfig
  } catch (e) {
    loadError.value = String(e) // 配置或指令文件读取失败
    return
  }
  if (showOnboarding.value) return
  vaultMissing.value = !!config.value.vaultPath && !(await dirExists(notesRoot(config.value)))
  try {
    const root = notesRoot(config.value)
    const records = (await listEditRecoveries()).filter((r) => r.root === root)
    const latest = records.sort((a, b) => b.savedAt - a.savedAt)[0]
    if (latest && !vaultMissing.value) openSavedNote(latest.path)
  } catch {
    toast('未保存的修改读取失败，请稍后重试。', { kind: 'error' })
  }
})

async function onSaved(c: Config) {
  config.value = c
  vaultMissing.value = !!c.vaultPath && !(await dirExists(notesRoot(c)))
}
function finishOnboarding(c: Config, skipped: boolean) {
  config.value = c
  onboardingState.value.finished = true
  page.value = 'home'
  showOnboarding.value = false
  celebrationPending.value = !onboardingState.value.celebrated
  toast(skipped ? '欢迎使用，需要时可到设置完成配置。' : '准备好了，放入第一条内容试试。')
}
async function markCelebrated() {
  onboardingState.value.celebrated = true
  try {
    await saveOnboarding({ ...onboardingState.value })
  } catch {
    toast('礼花播放记录保存失败，下次启动可能再次播放。', { kind: 'error' })
  }
}
</script>

<template>
  <p v-if="loadError" class="fatal">启动失败：配置或整理指令无法读取。{{ loadError }}</p>
  <template v-else-if="config">
    <TitleBar :page="page" :only-settings="false" :hide-navigation="showOnboarding" @navigate="navigate" />
    <!-- 标题栏下面的内容区自己滚动，整个窗口不出滚动条，标题栏的宽度和位置就不会跟着页面变 -->
    <OnboardingPage v-if="showOnboarding" :config="config" @done="finishOnboarding" />
    <div v-else v-page-fade="`${page}:${notePath ?? ''}`" class="app-body">
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
          @deleted="onNoteDeleted"
          @dirty="(v) => (noteDirty = v)"
          @go-settings="page = 'settings'"
          @config-changed="(c) => (config = c)"
        />
      </template>
      <SettingsPage
        v-if="page === 'settings'"
        ref="settings"
        :config="config"
        :first-run="false"
        @saved="onSaved"
        @pending="(v) => (settingsPending = v)"
        @domain-busy="(v) => (settingsDomainBusy = v)"
      />
      <div v-show="page === 'home'">
        <p v-if="vaultMissing" class="fatal">找不到收藏库：{{ notesRoot(config) }}。请到设置中重新选择。</p>
        <CollectPage
          v-if="prompts"
          :active="page === 'home'"
          :config="config"
          :prompts="prompts"
          @go-settings="page = 'settings'"
          @config-changed="(c) => (config = c)"
          @open-note="openSavedNote"
        />
      </div>
    </div>
    <WelcomeCelebration
      v-if="celebrationPending && !showOnboarding && page === 'home'"
      :played="onboardingState.celebrated"
      @played="markCelebrated"
      @finished="celebrationPending = false"
    />
    <ToastHost />
    <UnsavedDialog
      v-if="askSettings"
      :busy="savingSettings"
      @save="saveSettingsAndGo"
      @discard="discardSettingsAndGo"
      @stay="askSettings = null"
    />
    <NoticeDialog
      v-if="pendingPage"
      :title="UNSAVED_CHANGES"
      cancel-text="继续编辑"
      ok-text="不保存，离开"
      @cancel="pendingPage = null"
      @ok="leaveNote"
    >
      <p>{{ LEAVE_CHANGES_WARNING }}</p>
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
