<script setup lang="ts">
import type { Mode } from './core/note'
import { UNSAVED_CHANGES, LEAVE_CHANGES_WARNING } from './core/editMessages'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { vPageFade } from './components/pageFade'
import { type Config, parseConfig, notesRoot } from './core/config'
import {
  listEditRecoveries,
  readInterfaceFont,
  cleanupAttachmentParts,
  loadConfigJson,
  dirExists,
  ensurePrompts,
  restoreNote,
  loadOnboarding,
  saveOnboarding,
  inspectCollection,
  saveConfig,
} from './shell/tauri'
import type { Prompts } from './core/note'
import { loadImportedFont } from './core/importedFont'
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
import { GITHUB_URL } from './core/projectInfo'
import { createUpdateCheck, updateKey } from './components/useUpdate'
import { openLink as openUpdateLink } from './shell/tauri'
import UnsavedDialog from './components/UnsavedDialog.vue'
import ToastHost from './components/ToastHost.vue'
import { toast } from './components/useToast'

const config = ref<Config | null>(null)
const prompts = ref<Prompts | null>(null)
watch(
  () => [config.value?.interfaceFont, config.value?.importedFonts] as const,
  async ([font, imported], _, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    const file = imported?.find((entry) => entry.family === font)
    if (file) {
      try {
        await loadImportedFont(file, readInterfaceFont)
      } catch {
        font = undefined
      }
    }
    if (cancelled) return
    if (font) document.documentElement.style.setProperty('--interface-font', JSON.stringify(font))
    else document.documentElement.style.removeProperty('--interface-font')
  },
)
const page = ref<Page>('home')
const closeOrigin = ref<Page | null>(null)
function revealCollectForClose() {
  closeOrigin.value ??= page.value
  page.value = 'home'
}
function cancelCollectClose() {
  if (closeOrigin.value) page.value = closeOrigin.value
  closeOrigin.value = null
}
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
let scanningConfig: Config | null = null

/** 外部新增目录同步到当前会话。正常保存设置或重启时再走既有配置写入。 */
async function syncLibraryDomains() {
  const current = config.value
  if (page.value !== 'library' || !current?.vaultPath || scanningConfig === current) return
  scanningConfig = current
  try {
    const result = await inspectCollection(current)
    // 扫描期间可能已切换库或在别处改了配置。
    if (page.value === 'library' && config.value === current && result.config !== current) {
      config.value = result.config
    }
  } catch {
    // 目录暂时无法访问时保留当前领域，下一次进入或聚焦时重试。
  } finally {
    if (scanningConfig === current) scanningConfig = null
  }
}
watch(page, () => void syncLibraryDomains())
const { update, visible: updateVisible, open: showUpdate, check: checkUpdate } = createUpdateCheck()
provide(updateKey, {
  update,
  open: () => {
    if (!downloadingUpdate.value) updateDownloadFailed.value = false
    showUpdate()
  },
})
onMounted(() => void checkUpdate())

const collect = ref<InstanceType<typeof CollectPage>>()
const downloadingUpdate = ref(false)
const updateDownloaded = ref(false)
const downloadedBytes = ref(0)
const downloadTotal = ref<number>()
const updatePercent = computed(() =>
  downloadTotal.value ? Math.min(100, (downloadedBytes.value / downloadTotal.value) * 100) : 0,
)
const updateDownloadFailed = ref(false)

function hasPendingUpdateChanges() {
  return noteDirty.value || settingsPending.value || settingsDomainBusy.value || collect.value?.hasUnsaved()
}

async function downloadUpdate() {
  if (!update.value || downloadingUpdate.value) return
  if (updateDownloadFailed.value) {
    try {
      await openUpdateLink(GITHUB_URL + '/releases')
    } catch {
      toast('无法打开 GitHub，请稍后重试。', { kind: 'error' })
    }
    return
  }
  if (hasPendingUpdateChanges()) {
    toast('请先保存或放弃当前内容，再更新。')
    return
  }
  downloadedBytes.value = 0
  downloadTotal.value = undefined
  downloadingUpdate.value = true
  try {
    if (import.meta.env.DEV && import.meta.env.VITE_UPDATE_PREVIEW === '1') {
      downloadTotal.value = 100
      for (let step = 1; step <= 20; step++) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
        downloadedBytes.value = step * 5
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200))
      toast('模拟更新完成。')
      updateVisible.value = false
      return
    }
    if (!updateDownloaded.value) {
      await update.value.download?.((event) => {
        if (event.event === 'Started') downloadTotal.value = event.data.contentLength
        if (event.event === 'Progress') downloadedBytes.value += event.data.chunkLength
      })
      updateDownloaded.value = true
    }
    if (hasPendingUpdateChanges()) {
      toast('请先保存或放弃当前内容，再安装更新。')
      return
    }
    await update.value.install?.()
    updateVisible.value = false
  } catch {
    updateDownloadFailed.value = true
  } finally {
    downloadingUpdate.value = false
  }
}

onMounted(() => window.addEventListener('focus', syncLibraryDomains))
onBeforeUnmount(() => window.removeEventListener('focus', syncLibraryDomains))

function closeNote(changed: boolean) {
  notePath.value = null
  noteDirty.value = false
  if (changed) void library.value?.load()
}
/** 笔记删除了：回到收藏库，提示条上给「撤销」（从回收站还原笔记和图片） */
function onNoteDeleted(info: { root: string; path: string; images: string[] }) {
  closeNote(true)
  const n = info.images.length
  toast(`已移入回收站：笔记${n ? `及 ${n} 张图片` : ''}。`, {
    action: {
      label: '撤销',
      run: async () => {
        try {
          await restoreNote(info.root, info.path, info.images)
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
  if (notePage.value?.busy) return
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
    let loadedConfig = parseConfig(json)
    onboardingState.value = await loadOnboarding()
    showOnboarding.value = json === null && !onboardingState.value.finished
    prompts.value = (await ensurePrompts(DEFAULT_PROMPTS)) as Prompts
    if (!showOnboarding.value && loadedConfig.vaultPath) {
      vaultMissing.value = !(await dirExists(notesRoot(loadedConfig)))
      if (!vaultMissing.value) {
        await cleanupAttachmentParts(notesRoot(loadedConfig)).catch(() => {})
        try {
          const collection = await inspectCollection(loadedConfig)
          if (collection.config !== loadedConfig) {
            loadedConfig = collection.config
            await saveConfig(loadedConfig)
          }
        } catch {
          toast('已有领域同步失败，请重新打开软件后重试。', { kind: 'error' })
        }
      }
    }
    config.value = loadedConfig
  } catch (e) {
    loadError.value = String(e) // 配置或指令文件读取失败
    return
  }
  if (showOnboarding.value) return
  try {
    const root = notesRoot(config.value)
    const records = (await listEditRecoveries()).filter((r) => r.root === root)
    const latest = records.sort((a, b) => b.savedAt - a.savedAt)[0]
    if (latest && !vaultMissing.value) openSavedNote(latest.path)
  } catch {
    toast('未保存的修改读取失败，请稍后重试。', { kind: 'error' })
  }
})

async function editFailedPrompt(mode: Mode) {
  page.value = 'settings'
  await nextTick()
  settings.value?.openPromptEditor(mode)
}

async function onSaved(c: Config) {
  config.value = c
  vaultMissing.value = !!c.vaultPath && !(await dirExists(notesRoot(c)))
}
function finishOnboarding(c: Config, welcomePath?: string) {
  config.value = c
  onboardingState.value.finished = true
  page.value = 'home'
  showOnboarding.value = false
  celebrationPending.value = !onboardingState.value.celebrated
  if (welcomePath) {
    toast('欢迎笔记已放进收藏库，可以先看看。', {
      action: { label: '去看看', run: () => openSavedNote(welcomePath) },
    })
  }
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
      <div v-if="page === 'library' || closeOrigin === 'library'" v-show="page === 'library'">
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
      </div>
      <div v-if="page === 'settings' || closeOrigin === 'settings'" v-show="page === 'settings'">
        <SettingsPage
          ref="settings"
          :prompts="prompts ?? DEFAULT_PROMPTS"
          :config="config"
          :first-run="false"
          @saved="onSaved"
          @pending="(v) => (settingsPending = v)"
          @domain-busy="(v) => (settingsDomainBusy = v)"
        />
      </div>
      <div v-show="page === 'home'">
        <p v-if="vaultMissing" class="fatal">找不到收藏库：{{ notesRoot(config) }}。请到设置中重新选择。</p>
        <CollectPage
          v-if="prompts"
          ref="collect"
          :active="page === 'home'"
          :config="config"
          :prompts="prompts"
          @go-settings="page = 'settings'"
          @edit-prompt="editFailedPrompt"
          @config-changed="(c) => (config = c)"
          @open-note="openSavedNote"
          @reveal-for-close="revealCollectForClose"
          @close-cancelled="cancelCollectClose"
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
      v-if="updateVisible && update"
      title="发现新版本"
      cancel-text="稍后"
      :ok-text="
        downloadingUpdate
          ? undefined
          : updateDownloadFailed
            ? '前往 GitHub 下载'
            : updateDownloaded
              ? '安装更新'
              : '下载并安装'
      "
      @cancel="updateVisible = false"
      @ok="downloadUpdate"
    >
      <p>当前版本 v{{ update.current }}，最新版本 v{{ update.version }}。</p>
      <template v-if="downloadingUpdate">
        <p role="status">
          {{ updateDownloaded ? '正在安装更新…' : downloadedBytes ? '正在下载安装包…' : '正在连接下载服务器…' }}
          {{
            downloadTotal
              ? Math.min(100, Math.floor((downloadedBytes / downloadTotal) * 100)) + '%'
              : (downloadedBytes / 1048576).toFixed(1) + ' MB'
          }}
        </p>
        <div
          v-if="downloadTotal"
          class="update-progress"
          role="progressbar"
          aria-label="安装包下载进度"
          :aria-valuenow="updatePercent"
        >
          <div class="update-progress-fill" :style="{ width: updatePercent + '%' }" />
        </div>
      </template>
      <p v-if="updateDownloadFailed" role="status">更新失败，可前往 GitHub 手动下载安装。</p>
      <p v-if="update.notes" class="update-notes">{{ update.notes }}</p>
    </NoticeDialog>
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
.update-progress {
  height: 5px;
  margin-block: var(--sp-2);
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--hover);
}
.update-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
}
@media (prefers-reduced-motion: no-preference) {
  .update-progress-fill {
    transition: width 180ms linear;
  }
}
.update-notes {
  max-height: 12rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
