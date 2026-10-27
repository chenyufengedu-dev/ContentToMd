<script setup lang="ts">
// 独立体验入口：所有仓库、选目录、网络测试均为内存模拟，不调用外壳或读写配置。
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Check, ChevronRight, ExternalLink, Folder, Minus, Square, X } from '../src/components/icons'
import { vPress } from '../src/components/pressFeedback'
import SelectBox from '../src/components/SelectBox.vue'
import NoticeDialog from '../src/components/NoticeDialog.vue'
import { checkBaseUrl, defaultConfig, SERVICE_KINDS, SERVICE_LABELS, type ServiceKind } from '../src/core/config'
import OnboardingBrand from './OnboardingBrand.vue'
import OnboardingHome from './OnboardingHome.vue'
import { resetWelcomeCelebrationPreview } from './welcomeCelebration'

const step = ref(0)
const direction = ref('forward')
const heading = ref<HTMLElement>()
const result = ref<'complete' | 'skip' | null>(null)
const askSkip = ref(false)
const tools = ref(false)
const reduced = ref(false)
const detected = ref('multiple')
const outcome = ref('success')
const folderPicker = ref(false)
const folder = ref('文档 / 收藏库')
const pendingFolder = ref(folder.value)
const folderChoices = ['文档 / 收藏库', '桌面 / 我的收藏']
const contentScroll = ref<HTMLElement>()
const vaultOpen = ref(false)
const vaultToggle = ref<HTMLButtonElement>()
const vault = ref('')
const subfolder = ref('')
const aiMode = ref<'recommended' | 'custom'>('recommended')
const customKind = ref<ServiceKind>('text')
const customTabs = ref<HTMLButtonElement[]>([])
const recommendedKey = ref('')
const audioOpen = ref(false)
const savedServices = defaultConfig().services
interface PreviewService {
  kind: ServiceKind
  baseUrl: string
  model: string
  apiKey: string
  status: 'idle' | 'testing' | 'ok' | 'fail'
  message: string
}
function newService(kind: ServiceKind, recommended: boolean): PreviewService {
  return {
    kind,
    baseUrl: recommended ? savedServices[kind].baseUrl : '',
    model: recommended ? savedServices[kind].model : '',
    apiKey: '',
    status: 'idle',
    message: '',
  }
}
const recommendedServices = reactive({
  text: newService('text', true),
  vision: newService('vision', true),
  asr: newService('asr', true),
})
const customServices = reactive({
  text: newService('text', false),
  vision: newService('vision', false),
  asr: newService('asr', false),
})
const services = computed(() => (aiMode.value === 'recommended' ? recommendedServices : customServices))
const currentCustom = computed(() => customServices[customKind.value])
const allServices = [...Object.values(recommendedServices), ...Object.values(customServices)]
const recommendedState = computed(() => {
  const required = [recommendedServices.text, recommendedServices.vision]
  const failed = required.find((s) => s.status === 'fail')
  if (failed) return { status: 'fail', message: failed.message }
  if (required.every((s) => s.status === 'ok')) return { status: 'ok', message: '文字与图片已连接' }
  if (required.some((s) => s.status === 'testing')) return { status: 'testing', message: '正在测试文字与图片…' }
  return { status: 'idle', message: '' }
})
const vaults = computed(() =>
  detected.value === 'none'
    ? []
    : [
        { name: '个人笔记', path: 'D:\\Notes\\个人笔记' },
        ...(detected.value === 'multiple' ? [{ name: '工作笔记', path: 'D:\\Notes\\工作笔记' }] : []),
      ],
)
const selectedVault = computed(() => vaults.value.find((v) => v.path === vault.value))
const pathLabel = computed(() =>
  selectedVault.value ? `${selectedVault.value.name} / ${subfolder.value || '仓库根目录'}` : folder.value,
)
const canFinish = computed(() =>
  Object.values(services.value).every((s) => (s.kind === 'asr' && !s.apiKey.trim()) || s.status === 'ok'),
)
const isTesting = computed(() => Object.values(services.value).some((s) => s.status === 'testing'))
const finalActionLabel = computed(() => (isTesting.value ? '正在连接…' : canFinish.value ? '开始使用' : '暂时跳过'))
const hasDraftInput = computed(
  () =>
    folder.value !== '文档 / 收藏库' ||
    !!vault.value ||
    allServices.some((s) => !!s.apiKey.trim()) ||
    Object.values(customServices).some((s) => !!(s.baseUrl.trim() || s.model.trim())),
)
const subfolders = computed(() => [
  { value: '', label: '仓库根目录' },
  { value: '收藏', label: '收藏' },
  {
    value: selectedVault.value?.name === '工作笔记' ? '项目资料' : '读书笔记',
    label: selectedVault.value?.name === '工作笔记' ? '项目资料' : '读书笔记',
  },
])

// 每次替换、离开和卸载都取消旧计时；迟到的模拟结果不能覆盖新输入。
const requests = new Map<PreviewService, AbortController>()
function cancelTests() {
  requests.forEach((controller) => controller.abort())
  requests.clear()
  allServices.forEach((s) => {
    if (s.status === 'testing') s.status = 'idle'
  })
}
function scheduleTest(s: PreviewService) {
  requests.get(s)?.abort()
  s.status = 'idle'
  s.message = ''
  if (
    !Object.values(services.value).includes(s) ||
    step.value !== 2 ||
    result.value ||
    !s.apiKey.trim() ||
    !s.model.trim() ||
    !s.baseUrl.trim()
  )
    return
  const controller = new AbortController()
  requests.set(s, controller)
  s.status = 'testing'
  let timer = window.setTimeout(() => {
    const invalid = checkBaseUrl(s.baseUrl)
    if (invalid) {
      s.status = 'fail'
      s.message = invalid
      return
    }
    timer = window.setTimeout(() => {
      if (controller.signal.aborted) return
      s.status = outcome.value === 'success' ? 'ok' : 'fail'
      s.message = outcome.value === 'success' ? '连接成功' : '模拟连接失败，请检查后重试。'
    }, 900)
  }, 500)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
}
allServices.forEach((s) =>
  watch(
    () => [s.baseUrl, s.model, s.apiKey],
    () => scheduleTest(s),
  ),
)
watch(recommendedKey, (key) => {
  recommendedServices.text.apiKey = key
  recommendedServices.vision.apiKey = key
})
function resumeTests() {
  cancelTests()
  Object.values(services.value).forEach((s) => {
    if (s.status !== 'ok') scheduleTest(s)
  })
}
watch(aiMode, () => {
  resumeTests()
})
watch(outcome, () => Object.values(services.value).forEach(scheduleTest))
watch(detected, () => {
  vault.value = ''
  subfolder.value = ''
  vaultOpen.value = false
})
watch(vault, () => {
  subfolder.value = ''
})
watch(step, resumeTests)
onBeforeUnmount(cancelTests)

function go(next: number) {
  if (next < 0 || next > 2) return
  direction.value = next > step.value ? 'forward' : 'back'
  step.value = next
}
function finish(skip = false) {
  if (!skip && !canFinish.value) return
  cancelTests()
  result.value = skip ? 'skip' : 'complete'
  if (skip) {
    resetServices()
    folder.value = '文档 / 收藏库'
    vault.value = ''
    subfolder.value = ''
  }
  void nextTick(focusHeading)
}
function finalAction() {
  if (isTesting.value) return
  if (canFinish.value) finish()
  else if (hasDraftInput.value) askSkip.value = true
  else finish(true)
}
function confirmSkip() {
  askSkip.value = false
  finish(true)
}
function focusHeading() {
  if (contentScroll.value) contentScroll.value.scrollTop = 0
  heading.value?.focus({ preventScroll: true })
}
function restartCelebration() {
  resetWelcomeCelebrationPreview()
  restart()
  tools.value = false
}

function restart() {
  askSkip.value = false
  cancelTests()
  resetServices()
  result.value = null
  step.value = 0
  folder.value = '文档 / 收藏库'
  folderPicker.value = false
  vault.value = ''
  subfolder.value = ''
  vaultOpen.value = false
  void nextTick(focusHeading)
}
function resetServices() {
  recommendedKey.value = ''
  for (const kind of SERVICE_KINDS) {
    Object.assign(recommendedServices[kind], newService(kind, true))
    Object.assign(customServices[kind], newService(kind, false))
  }
  aiMode.value = 'recommended'
  customKind.value = 'text'
  audioOpen.value = false
}
function onCustomTabKey(event: KeyboardEvent, index: number) {
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % 3
      : event.key === 'ArrowLeft'
        ? (index + 2) % 3
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 2
            : undefined
  if (next === undefined) return
  event.preventDefault()
  customKind.value = SERVICE_KINDS[next]
  customTabs.value[next]?.focus()
}
function onModeKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  aiMode.value =
    event.key === 'Home'
      ? 'recommended'
      : event.key === 'End'
        ? 'custom'
        : aiMode.value === 'recommended'
          ? 'custom'
          : 'recommended'
  const group = event.currentTarget
  if (group instanceof HTMLElement)
    void nextTick(() => group.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
}
function useFolder() {
  folder.value = pendingFolder.value
  vault.value = ''
  subfolder.value = ''
  vaultOpen.value = false
  folderPicker.value = false
}
function openFolderPicker() {
  pendingFolder.value = folder.value
  vaultOpen.value = false
  folderPicker.value = true
}
function chooseVault(path: string) {
  vault.value = path
  vaultOpen.value = false
  void nextTick(() => vaultToggle.value?.focus({ preventScroll: true }))
}
</script>

<template>
  <div class="preview" :class="{ 'reduce-motion': reduced }">
    <header class="preview-titlebar">
      <div class="brand"><img src="../src/assets/app-mark.svg" alt="" /><span>ContentToMd</span></div>
      <button class="preview-label" :class="{ 'home-tools': result }" :aria-expanded="tools" @click="tools = !tools">
        体验选项 · 模拟数据
      </button>
      <div class="window-icons" aria-hidden="true"><Minus :size="16" /><Square :size="13" /><X :size="16" /></div>
    </header>

    <aside v-if="tools" class="preview-tools" aria-label="原型体验选项">
      <strong>仅用于体验，不保存配置；只记录礼花是否播放过。</strong>
      <p>密钥框请填任意测试字符，不要填真实密钥。</p>
      <label
        >Obsidian 检测
        <select v-model="detected">
          <option value="none">未检测到</option>
          <option value="one">一个仓库</option>
          <option value="multiple">多个仓库</option>
        </select>
      </label>
      <label
        >模拟连接结果
        <select v-model="outcome">
          <option value="success">成功</option>
          <option value="fail">失败</option>
        </select>
      </label>
      <label class="checkbox"><input v-model="reduced" type="checkbox" />减少切换和呼吸动画</label>
      <div class="tool-actions">
        <button @click="restart">重新体验</button>
        <button @click="restartCelebration">重置礼花体验</button>
        <button @click="tools = false">收起</button>
      </div>
    </aside>

    <OnboardingHome v-if="result" :result="result" :reduced="reduced" />
    <main v-else class="canvas">
      <section class="guide-frame" aria-label="首次使用引导">
        <div class="guide-sheet">
          <ol v-if="!result" class="progress" aria-label="引导进度">
            <li
              v-for="(title, i) in ['欢迎', '保存位置', '连接 AI']"
              :key="title"
              :class="{ current: step === i }"
              :aria-current="step === i ? 'step' : undefined"
            >
              <span class="sr-only">第 {{ i + 1 }} 步：{{ title }}</span>
            </li>
          </ol>

          <button
            v-if="!result && step > 0"
            v-press
            class="round previous"
            aria-label="上一步"
            title="上一步"
            @click="go(step - 1)"
          >
            <ChevronRight class="back-icon" :size="18" />
          </button>
          <button
            v-if="!result && step < 2"
            v-press
            class="round next"
            :aria-label="step === 0 ? '开始' : '下一步'"
            :title="step === 0 ? '开始' : '下一步'"
            @click="go(step + 1)"
          >
            <ChevronRight :size="18" />
            <span v-if="step === 0" class="start-label">开始</span>
          </button>

          <div
            ref="contentScroll"
            class="content-scroll"
            :class="{ 'welcome-scroll': step === 0, 'services-scroll': step === 2 }"
            :data-direction="direction"
          >
            <Transition name="step" mode="out-in" @after-enter="focusHeading">
              <div v-if="step === 0" key="welcome" class="welcome">
                <h1 ref="heading" tabindex="-1" class="eyebrow">开始使用 / 01</h1>
                <OnboardingBrand />
                <p class="intro">把视频、截图、文档放进来，AI 整理成 Markdown 笔记。</p>
              </div>
              <div v-else-if="step === 1" key="location" class="location">
                <p class="eyebrow">开始使用 / 02</p>
                <h1 ref="heading" tabindex="-1">笔记存在哪里</h1>
                <p class="subtitle">笔记和图片会保存在这里。</p>
                <div class="folder-section">
                  <label>收藏库文件夹</label>
                  <div class="path-row">
                    <div class="path" :title="pathLabel">
                      <Folder :size="18" /><span>{{ pathLabel }}</span>
                    </div>
                    <button v-press class="soft" aria-haspopup="dialog" @click="openFolderPicker">更换</button>
                  </div>
                  <p class="helper">文件夹不存在时会自动创建。</p>
                </div>
                <div v-if="vaults.length" class="obsidian-section">
                  <div class="obsidian-heading">
                    <svg class="obsidian-mark" viewBox="0 0 24 28" aria-hidden="true">
                      <path fill="#7c51d1" d="M14 0 3 8 0 19 8 27 20 25 24 10Z" />
                      <path fill="#aa8bea" d="m14 0-3 12 13-2Z" />
                      <path fill="#6132ad" d="m11 12 9 13-12 2Z" />
                      <path fill="#9871df" d="m3 8 8 4-3 15L0 19Z" /></svg
                    ><span>{{ selectedVault ? 'Obsidian 仓库' : '检测到 Obsidian' }}</span
                    ><button
                      ref="vaultToggle"
                      v-press
                      class="link"
                      :aria-expanded="vaultOpen"
                      @click="vaultOpen = !vaultOpen"
                    >
                      {{ vaultOpen ? '取消' : selectedVault ? '更换仓库' : '选择仓库'
                      }}<ChevronRight :size="14" :class="{ turned: vaultOpen }" />
                    </button>
                  </div>
                  <div v-if="vaultOpen" class="vault-options">
                    <div class="vault-list" role="radiogroup" aria-label="选择模拟 Obsidian 仓库">
                      <button
                        v-for="v in vaults"
                        :key="v.path"
                        v-press
                        role="radio"
                        :aria-checked="vault === v.path"
                        :class="{ selected: vault === v.path }"
                        :title="v.path"
                        @click="chooseVault(v.path)"
                      >
                        <span
                          ><strong>{{ v.name }}</strong
                          ><small>{{ v.path }}</small></span
                        ><Check v-if="vault === v.path" :size="16" />
                      </button>
                    </div>
                  </div>
                  <label v-if="selectedVault && !vaultOpen" class="subfolder"
                    ><span>存放文件夹</span
                    ><SelectBox v-model="subfolder" :options="subfolders" aria-label="存放文件夹"
                  /></label>
                </div>
              </div>
              <div v-else key="services" class="services">
                <p class="eyebrow">开始使用 / 03</p>
                <h1 ref="heading" tabindex="-1">连接 AI</h1>
                <p class="subtitle">使用你自己的 AI 服务，费用由服务商收取。</p>
                <div class="mode-switch" role="tablist" aria-label="AI 配置方式" @keydown="onModeKey">
                  <span class="mode-thumb" :style="{ '--i': aiMode === 'recommended' ? 0 : 1 }" aria-hidden="true" />
                  <button
                    id="mode-recommended"
                    v-press
                    role="tab"
                    :aria-selected="aiMode === 'recommended'"
                    :tabindex="aiMode === 'recommended' ? 0 : -1"
                    aria-controls="ai-mode-panel"
                    @click="aiMode = 'recommended'"
                  >
                    推荐配置
                  </button>
                  <button
                    id="mode-custom"
                    v-press
                    role="tab"
                    :aria-selected="aiMode === 'custom'"
                    :tabindex="aiMode === 'custom' ? 0 : -1"
                    aria-controls="ai-mode-panel"
                    @click="aiMode = 'custom'"
                  >
                    自定义
                  </button>
                </div>
                <Transition name="mode" mode="out-in">
                  <div
                    v-if="aiMode === 'recommended'"
                    id="ai-mode-panel"
                    key="recommended"
                    class="recommended-panel"
                    role="tabpanel"
                    aria-labelledby="mode-recommended"
                  >
                    <div class="provider-heading">
                      <h2>DeepSeek</h2>
                      <a
                        v-press
                        class="key-link"
                        href="https://platform.deepseek.com/api_keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerpolicy="no-referrer"
                        >获取密钥<ExternalLink :size="12"
                      /></a>
                    </div>
                    <p class="helper provider-description">用于整理文字和图片。</p>
                    <input
                      v-model="recommendedKey"
                      type="password"
                      autocomplete="off"
                      spellcheck="false"
                      aria-label="DeepSeek API 密钥"
                      :aria-invalid="recommendedState.status === 'fail'"
                      placeholder="填入测试字符（非真实密钥）"
                    />
                    <p class="test-state status-slot" :class="recommendedState.status" role="status">
                      <span v-if="recommendedState.status === 'testing'" class="spinner" /><Check
                        v-else-if="recommendedState.status === 'ok'"
                        :size="14"
                      />{{ recommendedState.message }}
                    </p>
                    <div class="audio-section">
                      <button v-press class="audio-toggle" :aria-expanded="audioOpen" @click="audioOpen = !audioOpen">
                        音视频转写<span class="optional">选填</span
                        ><Check v-if="recommendedServices.asr.status === 'ok'" :size="14" /><span
                          v-else-if="recommendedServices.asr.status === 'fail'"
                          class="audio-failed"
                          >未连接</span
                        ><span v-else-if="recommendedServices.asr.status === 'testing'" class="spinner" /><ChevronRight
                          :size="14"
                          :class="{ turned: audioOpen }"
                        />
                      </button>
                      <p class="helper audio-description">
                        如需整理视频或音频，请配置转写服务。推荐使用硅基流动的 SenseVoiceSmall 模型。
                      </p>
                      <div v-if="audioOpen" class="audio-fields">
                        <div class="provider-heading">
                          <strong>硅基流动</strong
                          ><a
                            v-press
                            class="key-link"
                            href="https://cloud.siliconflow.cn/account/ak"
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerpolicy="no-referrer"
                            >获取密钥<ExternalLink :size="12"
                          /></a>
                        </div>
                        <input
                          v-model="recommendedServices.asr.apiKey"
                          type="password"
                          autocomplete="off"
                          placeholder="填入测试字符（非真实密钥）"
                          aria-label="音视频转写 API 密钥"
                          :aria-invalid="recommendedServices.asr.status === 'fail'"
                        />
                        <p class="test-state status-slot" :class="recommendedServices.asr.status" role="status">
                          <span v-if="recommendedServices.asr.status === 'testing'" class="spinner" /><Check
                            v-else-if="recommendedServices.asr.status === 'ok'"
                            :size="14"
                          />{{
                            recommendedServices.asr.status === 'testing'
                              ? '正在测试连接…'
                              : recommendedServices.asr.message
                          }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div
                    v-else
                    id="ai-mode-panel"
                    key="custom"
                    class="custom-panel"
                    role="tabpanel"
                    aria-labelledby="mode-custom"
                  >
                    <div class="capability-tabs" role="tablist" aria-label="自定义服务用途">
                      <button
                        v-for="(kind, i) in SERVICE_KINDS"
                        :id="`purpose-${kind}`"
                        :key="kind"
                        ref="customTabs"
                        role="tab"
                        :aria-selected="customKind === kind"
                        :tabindex="customKind === kind ? 0 : -1"
                        aria-controls="custom-fields"
                        @click="customKind = kind"
                        @keydown="onCustomTabKey($event, i)"
                      >
                        {{ SERVICE_LABELS[kind] }}<span v-if="kind === 'asr'" class="optional">选填</span
                        ><Check v-if="customServices[kind].status === 'ok'" :size="12" />
                      </button>
                    </div>
                    <div
                      id="custom-fields"
                      class="custom-fields"
                      role="tabpanel"
                      :aria-labelledby="`purpose-${customKind}`"
                    >
                      <label
                        >接口地址<input
                          v-model="currentCustom.baseUrl"
                          type="url"
                          autocomplete="off"
                          placeholder="https://…"
                          :aria-label="`${SERVICE_LABELS[customKind]}接口地址`"
                      /></label>
                      <label
                        >模型名称<input
                          v-model="currentCustom.model"
                          autocomplete="off"
                          placeholder="填写模型名称"
                          :aria-label="`${SERVICE_LABELS[customKind]}模型名称`"
                      /></label>
                      <label
                        >API 密钥<input
                          v-model="currentCustom.apiKey"
                          type="password"
                          autocomplete="off"
                          spellcheck="false"
                          placeholder="填入测试字符（非真实密钥）"
                          :aria-label="`${SERVICE_LABELS[customKind]} API 密钥`"
                          :aria-invalid="currentCustom.status === 'fail'"
                      /></label>
                      <p class="test-state status-slot" :class="currentCustom.status" role="status">
                        <span v-if="currentCustom.status === 'testing'" class="spinner" /><Check
                          v-else-if="currentCustom.status === 'ok'"
                          :size="14"
                        />{{
                          currentCustom.status === 'testing'
                            ? '正在测试连接…'
                            : currentCustom.message || '填写完成后自动测试连接。'
                        }}
                      </p>
                    </div>
                  </div>
                </Transition>
              </div>
            </Transition>
          </div>
          <button
            v-if="!result && step === 2"
            v-press="'tactile'"
            class="primary finish-action"
            :disabled="isTesting"
            :aria-busy="isTesting"
            @click="finalAction"
          >
            {{ finalActionLabel }}
          </button>
          <button v-if="!result && step < 2" v-press class="skip" @click="finish(true)">暂时跳过</button>
        </div>
      </section>
    </main>
    <NoticeDialog
      v-if="askSkip"
      title="放弃本次配置？"
      cancel-text="继续配置"
      ok-text="放弃并跳过"
      danger
      @cancel="askSkip = false"
      @ok="confirmSkip"
    >
      <p>本次引导填写的内容不会保存，之后可在设置中重新配置。</p>
    </NoticeDialog>
    <NoticeDialog
      v-if="folderPicker"
      title="选择文件夹"
      cancel-text="取消"
      ok-text="选择文件夹"
      @cancel="folderPicker = false"
      @ok="useFolder"
    >
      <p>体验稿仅模拟选择，不访问磁盘。</p>
      <div class="folder-choices" role="radiogroup" aria-label="模拟文件夹">
        <button
          v-for="choice in folderChoices"
          :key="choice"
          v-press
          role="radio"
          :aria-checked="pendingFolder === choice"
          :class="{ selected: pendingFolder === choice }"
          @click="pendingFolder = choice"
        >
          <Folder :size="18" /><span>{{ choice }}</span
          ><Check v-if="pendingFolder === choice" :size="16" />
        </button>
      </div>
    </NoticeDialog>
  </div>
</template>

<style scoped>
.preview {
  --guide-width: 640px;
  --guide-height: 440px;
  --guide-gutter: calc(var(--sp-7) * 3);
  min-height: 100dvh;
  background: var(--bg);
}
.preview-titlebar {
  height: var(--titlebar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-4);
  position: relative;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.brand img {
  width: auto;
  height: var(--brand-logo-size);
}
.brand span {
  font-family: 'Gabriola', 'Palatino Linotype', serif;
  font-size: var(--brand-font-size);
  padding-top: var(--brand-baseline-offset);
}
.preview-label {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  height: var(--h-xs);
  border: 0;
  background: transparent;
  color: var(--faint);
  font-size: var(--fs-xs);
}
.preview-label.home-tools {
  position: fixed;
  top: auto;
  bottom: var(--sp-4);
  left: var(--sp-6);
  transform: none;
  z-index: 55;
}
.window-icons {
  display: flex;
  align-items: center;
  gap: var(--sp-7);
  padding-right: var(--sp-2);
  color: var(--muted);
}
.canvas {
  height: calc(100dvh - var(--titlebar-h));
  display: grid;
  place-items: center;
  padding: var(--sp-6);
  box-sizing: border-box;
}
/* 与 NoteCard 的框体使用完全相同的令牌与表达式，不复制卡片的按钮/抽出行为。 */
.guide-frame {
  --ring: calc(var(--sp-4) / 4);
  width: min(var(--guide-width), 100%);
  height: min(var(--guide-height), 100%);
  padding: var(--ring);
  border: 0;
  border-radius: calc(var(--panel-radius) + var(--ring));
  background: var(--line);
  box-shadow: var(--shadow-card);
  box-sizing: border-box;
}
.guide-sheet {
  height: 100%;
  position: relative;
  border-radius: var(--panel-radius);
  background: var(--card);
  overflow: hidden;
}
.progress {
  position: absolute;
  top: var(--sp-6);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  list-style: none;
  padding: 0;
  margin: 0;
  height: var(--sp-4);
}
.progress li {
  position: relative;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
}
.progress li::after {
  /* 实心点始终盖在光晕上方；光晕结束时也不会把点涂白。 */
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--line-strong);
}
.progress li.current {
  width: 7px;
  height: 7px;
}
.progress li.current::after {
  background: var(--accent);
}
.progress li.current::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  background: var(--accent);
  opacity: 0.1;
  filter: blur(2px);
  animation: breathe 3s ease-in-out 2;
}
.round {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--chip-bg);
  z-index: 2;
}
.round.previous {
  left: var(--sp-5);
  color: var(--muted);
}
.round.next {
  right: var(--sp-5);
}
.round svg {
  transition: translate var(--ease);
}
.back-icon {
  rotate: 180deg;
}
.round.next:hover:not(:disabled) svg {
  translate: 1px 0;
}
.round.previous:hover:not(:disabled) svg {
  translate: -1px 0;
}
.round:disabled {
  opacity: 1;
  color: var(--faint);
  background: var(--card-muted);
}
.start-label {
  position: absolute;
  top: calc(100% + var(--sp-2));
  color: var(--muted);
  font-size: var(--fs-md);
  font-weight: normal;
  white-space: nowrap;
}
.content-scroll {
  position: absolute;
  /* 留出8px绘制焦点光圈，同时保持原来的正文对齐线。 */
  inset: calc(var(--sp-7) + var(--sp-4) - var(--sp-2)) calc(var(--guide-gutter) - var(--sp-2))
    calc(var(--sp-7) + var(--sp-6) + var(--sp-1));
  padding: var(--sp-2);
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
  scrollbar-gutter: stable both-edges;
}
.content-scroll.welcome-scroll {
  inset-inline: calc(var(--sp-7) * 2 - var(--sp-2));
}
.content-scroll.services-scroll {
  right: var(--sp-6);
}
.content-scroll::-webkit-scrollbar {
  width: var(--sp-2);
}
.content-scroll::-webkit-scrollbar-thumb {
  border-radius: var(--radius-pill);
  background: var(--line-strong);
}
.content-scroll::-webkit-scrollbar-track {
  background: transparent;
}
h1,
p {
  margin: 0;
}
h1 {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-title);
  line-height: 1.4;
  color: var(--fg-strong);
  outline: none;
}
.eyebrow {
  color: var(--muted);
  font-size: var(--fs-md);
  font-weight: normal;
  line-height: 1.6;
  margin-bottom: var(--sp-1);
}
.subtitle {
  color: var(--muted);
  font-size: var(--fs-lg);
  margin-top: var(--sp-2);
  line-height: 1.6;
}
.welcome {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-5);
  text-align: center;
  box-sizing: border-box;
}
.welcome .eyebrow {
  margin-bottom: 0;
}
.intro {
  position: relative;
  left: var(--sp-6);
  white-space: nowrap;
  font-size: var(--fs-lg);
  line-height: 1.8;
}
.location {
  padding-top: var(--sp-2);
}
.folder-section {
  margin-top: var(--sp-6);
}
.folder-section > label,
.field-label {
  font-size: var(--fs-md);
  display: block;
  margin-bottom: var(--sp-2);
  color: var(--fg);
}
.path-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.path {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: var(--h-md);
  padding: 0 var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.path svg {
  flex-shrink: 0;
  color: var(--muted);
}
.path span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.soft {
  background: var(--hover);
  border: 0;
}
.helper {
  color: var(--faint);
  font-size: var(--fs-sm);
  line-height: 1.6;
  margin-top: var(--sp-2);
}
.obsidian-section {
  margin-top: var(--sp-6);
}
.obsidian-heading {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.obsidian-mark {
  width: 20px;
  height: 24px;
  flex-shrink: 0;
}
.obsidian-heading .link {
  padding: var(--sp-1) var(--sp-2);
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.turned {
  rotate: -90deg;
}
.vault-options {
  margin-top: var(--sp-2);
}
.vault-list {
  display: flex;
  flex-direction: column;
}
.vault-list button {
  height: auto;
  min-height: 44px;
  border: 0;
  border-radius: var(--radius-sm);
  padding: var(--sp-1) var(--sp-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
}
.vault-list button.selected {
  background: var(--accent-soft);
}
.vault-list button > span {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-width: 0;
}
.vault-list strong {
  font-weight: var(--fw-label);
}
.vault-list small {
  font-size: var(--fs-xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}
.vault-list svg {
  color: var(--accent);
}
.subfolder {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-4);
  align-items: center;
  margin-top: var(--sp-2);
}
.folder-choices {
  display: grid;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.folder-choices button {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-4);
  text-align: left;
}
.folder-choices button.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.folder-choices button > span {
  flex: 1;
}
.folder-choices .selected > svg:last-child {
  color: var(--accent);
}
.services .subtitle {
  font-size: var(--fs-md);
  margin-bottom: var(--sp-4);
}
/* 与 TitleBar/SettingsPage 同一滑块结构、圆角和260ms曲线，两个选项等宽。 */
.mode-switch {
  --mode-pad: 3px;
  --mode-gap: 2px;
  position: relative;
  display: flex;
  width: min(240px, 100%);
  box-sizing: border-box;
  gap: var(--mode-gap);
  padding: var(--mode-pad);
  margin: var(--sp-4) 0 var(--sp-4);
  background: var(--card-muted);
  border-radius: var(--radius-pill);
}
.mode-thumb {
  position: absolute;
  top: var(--mode-pad);
  left: var(--mode-pad);
  width: calc((100% - 2 * var(--mode-pad) - var(--mode-gap)) / 2);
  height: var(--h-md);
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: var(--shadow-card);
  transform: translateX(calc(var(--i) * (100% + var(--mode-gap))));
  transition: transform 260ms var(--motion-ease-out);
}
.mode-switch button {
  position: relative;
  flex: 1;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
}
.mode-switch button:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}
.mode-switch button[aria-selected='true'] {
  color: var(--accent);
}
.provider-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.provider-heading h2 {
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
  margin: 0;
}
.key-link {
  color: var(--accent);
  text-decoration: none;
  border-radius: var(--radius-sm);
  padding: var(--sp-1) var(--sp-2);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-sm);
}
.provider-description {
  margin: var(--sp-1) 0 var(--sp-1);
  font-size: var(--fs-md);
  color: var(--muted);
}
.audio-section {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--line);
  padding-top: var(--sp-1);
}
.audio-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  border: 0;
  background: none;
  height: var(--h-xs);
  padding: 0 var(--sp-1);
  color: var(--muted);
}
.audio-toggle > svg:nth-last-child(2) {
  color: var(--ok);
}
.audio-fields {
  margin-top: var(--sp-1);
}
.audio-failed {
  color: var(--err);
  font-size: var(--fs-sm);
}
.audio-fields > input {
  margin-top: var(--sp-2);
}
.capability-tabs {
  display: flex;
  gap: var(--sp-5);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--sp-5);
}
.capability-tabs button {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-1);
  border: 0;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--muted);
}
.capability-tabs button:hover:not(:disabled) {
  background: transparent;
}
.capability-tabs button:focus {
  outline: none;
}
.capability-tabs button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.capability-tabs button[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--accent);
}
.capability-tabs svg {
  color: var(--ok);
}
.custom-fields .test-state {
  padding-left: 72px;
}
.status-slot {
  min-height: var(--sp-5);
  color: var(--faint);
}
.mode-enter-active,
.mode-leave-active {
  transition:
    opacity 120ms ease,
    transform 150ms var(--motion-ease-out);
}
.mode-enter-from,
.mode-leave-to {
  opacity: 0;
  transform: translateY(3px);
}
.reduce-motion .mode-thumb,
.reduce-motion .mode-enter-active,
.reduce-motion .mode-leave-active {
  transition: none;
}
.reduce-motion .mode-enter-from,
.reduce-motion .mode-leave-to {
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .mode-thumb,
  .mode-enter-active,
  .mode-leave-active {
    transition: none;
  }
  .mode-enter-from,
  .mode-leave-to {
    transform: none;
  }
}
.optional {
  font-size: var(--fs-xs);
  color: var(--muted);
  background: var(--chip-bg);
  padding: 0 var(--sp-1);
  border-radius: var(--radius-sm);
}
input:not([type='checkbox']) {
  height: var(--h-md);
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 0 var(--sp-4);
  background: var(--card);
  color: var(--fg);
  font: inherit;
}
input::placeholder {
  color: var(--faint);
}
input:focus-visible {
  outline: 1px solid var(--accent);
  box-shadow: 0 0 0 var(--sp-1) var(--accent-soft);
}
.test-state {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-sm);
  margin-top: var(--sp-1);
  min-height: var(--sp-5);
  grid-column: 1 / -1;
}
.test-state.ok {
  color: var(--ok);
}
.test-state.fail {
  color: var(--err);
}
.test-state.testing {
  color: var(--muted);
}
.spinner {
  width: 10px;
  height: 10px;
  border: 1px solid var(--line);
  border-top-color: var(--accent);
  border-radius: var(--radius-pill);
  animation: spin 1s linear infinite;
}
.custom-fields {
  display: grid;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.custom-fields label {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  color: var(--muted);
}
.skip {
  position: absolute;
  bottom: var(--sp-5);
  left: 50%;
  transform: translateX(-50%);
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 0 var(--sp-4);
}
.skip:hover:not(:disabled) {
  background: var(--hover-soft);
  color: var(--fg);
}
.key-link:hover {
  background: var(--hover-soft);
}
.finish-action {
  position: absolute;
  bottom: var(--sp-5);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
}
.audio-description {
  margin-top: var(--sp-1);
  margin-bottom: 0;
  color: var(--muted);
}
.preview-tools {
  position: fixed;
  top: var(--titlebar-h);
  left: 50%;
  translate: -50% 0;
  width: 340px;
  padding: var(--sp-5);
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  background: var(--card);
  box-shadow: var(--shadow-pop);
  z-index: 10;
  display: grid;
  gap: var(--sp-4);
}
.preview-tools p {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.preview-tools label {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  align-items: center;
}
.preview-tools select {
  font: inherit;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--sp-1);
  background: var(--card);
  color: var(--fg);
}
.preview-tools .checkbox {
  justify-content: start;
}
.tool-actions {
  display: flex;
  justify-content: end;
  gap: var(--sp-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.step-enter-active,
.step-leave-active {
  transition:
    opacity 140ms ease,
    transform 180ms var(--motion-ease-out);
}
.step-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.step-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}
[data-direction='back'] .step-enter-from {
  transform: translateX(-8px);
}
[data-direction='back'] .step-leave-to {
  transform: translateX(6px);
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.06;
    transform: scale(0.85);
  }
  50% {
    opacity: 0.15;
    transform: scale(1.1);
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.reduce-motion .progress li::before,
.reduce-motion .spinner {
  animation: none;
}
.reduce-motion .step-enter-active,
.reduce-motion .step-leave-active,
.reduce-motion .round svg {
  transition: none;
}
.reduce-motion .step-enter-from,
.reduce-motion .step-leave-to {
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .progress li::before,
  .spinner {
    animation: none;
  }
  .step-enter-active,
  .step-leave-active,
  .round svg {
    transition: none;
  }
  .step-enter-from,
  .step-leave-to {
    transform: none;
  }
}
@media (max-width: 760px) {
  .preview {
    --guide-gutter: 88px;
  }
  .canvas {
    padding: var(--sp-4);
  }
  .round.previous {
    left: var(--sp-4);
  }
  .round.next {
    right: var(--sp-4);
  }
  .window-icons {
    gap: var(--sp-4);
  }
}
</style>
