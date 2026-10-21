<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { type Config, SERVICE_LABELS, isServiceConfigured, type ServiceKind } from '../core/config'
import { type Mode, MODES, type Prompts, type SourceType, preselectMode } from '../core/note'
import { type Job, newJob, runJob, STEP_LABELS } from '../core/pipeline'
import { describeError, isAppError, type ErrorCode } from '../core/errors'
import { httpFetch, listVaultTags, openNote } from '../shell/tauri'
import ConfirmPage from './ConfirmPage.vue'
import { Check, CircleCheck, Circle, FileVideo, LoaderCircle, Upload, X } from 'lucide-vue-next'

const props = defineProps<{ config: Config; prompts: Prompts }>()
const emit = defineEmits<{ goSettings: [] }>()

type Phase = 'drop' | 'processing' | 'failed' | 'confirm' | 'saved'
const phase = ref<Phase>('drop')

// ---- 投放区 ----
const AUDIO = ['mp3', 'm4a', 'wav']
const VIDEO = ['mp4', 'mov']
const MAX_BYTES = 1024 ** 3 // 音视频 ≤ 1GB（方案第 11 节）

const file = shallowRef<File | null>(null)
const fileType = ref<SourceType | null>(null)
const fileError = ref<string | null>(null)
const mode = ref<Mode>('要点提炼')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()

function accept(f: File) {
  fileError.value = null
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  const type: SourceType | null = VIDEO.includes(ext) ? '视频' : AUDIO.includes(ext) ? '音频' : null
  if (!type) {
    // 文字、图片、文档在 S1 后面几步再接入
    fileError.value = `这一版还不支持 .${ext || '（无扩展名）'} 文件，目前只能放入音视频：mp4、mov、mp3、m4a、wav`
    return
  }
  if (f.size > MAX_BYTES) {
    fileError.value = `“${f.name}”超过 1GB，请压缩或截取后再放入`
    return
  }
  file.value = f
  fileType.value = type
  mode.value = preselectMode(type)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (phase.value !== 'drop') return
  const f = e.dataTransfer?.files[0]
  if (f) accept(f)
}

function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) accept(f)
  ;(e.target as HTMLInputElement).value = ''
}

function removeFile() {
  job.value = null
  file.value = null
  fileType.value = null
}

// 开始前检查需要的服务（方案第 8 节“没有配置所需服务”）
const missingService = computed<string | null>(() => {
  const need: ServiceKind[] = ['asr', 'text']
  const k = need.find((k) => !isServiceConfigured(props.config.services[k]))
  return k ? SERVICE_LABELS[k] : null
})

// ---- 处理 ----
const job = ref<Job | null>(null)
const error = ref<{ code?: ErrorCode; message: string; detail?: string } | null>(null)
const existingTags = ref<string[]>([])
let abort: AbortController | null = null
const now = ref(Date.now())
let ticker: number | undefined

async function start() {
  if (!file.value || !fileType.value || missingService.value || phase.value !== 'drop') return
  // 取消后再开始：同一个文件、同一种整理方式时沿用已完成的步骤
  const same = job.value && job.value.fileName === file.value.name && job.value.mode === mode.value
  if (!same) job.value = reactive(newJob(file.value.name, fileType.value, mode.value)) as Job
  existingTags.value = await listVaultTags(props.config.vaultPath).catch(() => [])
  await run()
}

async function run() {
  if (!job.value) return
  const f = file.value!
  phase.value = 'processing'
  error.value = null
  abort = new AbortController()
  now.value = Date.now()
  ticker = window.setInterval(() => (now.value = Date.now()), 500)
  try {
    await runJob(job.value, {
      config: props.config,
      prompts: props.prompts,
      existingTags: existingTags.value,
      fetch: httpFetch,
      readFile: () => f.arrayBuffer(),
      cancel: abort.signal,
      onUpdate: () => {},
    })
    phase.value = 'confirm'
  } catch (e) {
    if (isAppError(e, 'cancelled')) {
      // 取消：已完成步骤的结果保留，回到投放区（方案第 8 节）
      job.value.steps.forEach((s) => s.status === 'failed' && (s.status = 'pending'))
      phase.value = 'drop'
    } else {
      error.value = describeError(e)
      phase.value = 'failed'
    }
  } finally {
    clearInterval(ticker)
    abort = null
  }
}

function cancel() {
  abort?.abort()
}

/** 返回修改：保留文件，丢掉这次的处理结果 */
function backToEdit() {
  job.value = null
  phase.value = 'drop'
}

const isAuthError = computed(() => error.value?.code === 'auth')

function elapsed(s: { startedAt?: number; endedAt?: number }) {
  if (!s.startedAt) return ''
  return `${Math.round(((s.endedAt ?? now.value) - s.startedAt) / 1000)} 秒`
}

// ---- 保存后 ----
const savedPath = ref('')
function onSaved(rel: string) {
  savedPath.value = rel
  phase.value = 'saved'
}
const openError = ref<string | null>(null)
async function open() {
  openError.value = null
  await openNote(props.config.vaultPath, savedPath.value).catch((e) => (openError.value = String(e)))
}
function next() {
  job.value = null
  removeFile()
  phase.value = 'drop'
}
function discard() {
  next()
}

// 快捷键：Ctrl+Enter 开始处理（方案第 11 节）
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter' && phase.value === 'drop') start()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const busy = computed(() => phase.value !== 'drop')
</script>

<template>
  <ConfirmPage
    v-if="phase === 'confirm' && job?.draft"
    :config="config"
    :job="job"
    :existing-tags="existingTags"
    @saved="onSaved"
    @discard="discard"
  />

  <main v-else-if="phase === 'saved'" class="page">
    <div class="card saved">
      <CircleCheck class="saved-icon" :size="40" aria-hidden="true" />
      <p class="saved-title">已保存</p>
      <p class="muted saved-path">{{ savedPath }}</p>
      <div class="row">
        <button @click="open">打开</button>
        <button class="primary" @click="next">继续收藏</button>
      </div>
      <p v-if="openError" class="err">{{ openError }}</p>
    </div>
  </main>

  <main v-else class="page">
    <div
      class="drop"
      :class="{ dragging, disabled: busy, has: file }"
      @dragover.prevent="dragging = !busy"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
      @click="!busy && !file && fileInput?.click()"
    >
      <template v-if="busy"><p class="muted">请先完成当前这一条</p></template>
      <template v-else-if="file">
        <div class="file">
          <span class="file-name"><FileVideo :size="18" aria-hidden="true" />{{ file.name }}</span>
          <span class="muted">{{ (file.size / 1048576).toFixed(1) }} MB · {{ fileType }}</span>
          <button class="link danger" @click.stop="removeFile">移除</button>
        </div>
      </template>
      <template v-else>
        <span class="drop-icon"><Upload :size="22" aria-hidden="true" /></span>
        <p class="big">拖入音视频文件</p>
        <p class="muted">或点击这里选择文件（mp4、mov、mp3、m4a、wav）</p>
      </template>
      <input ref="fileInput" type="file" accept=".mp4,.mov,.mp3,.m4a,.wav" hidden @change="onPick" />
    </div>
    <p v-if="fileError" class="err">{{ fileError }}</p>

    <div class="row options">
      <span>整理方式</span>
      <label v-for="m in MODES" :key="m" class="radio">
        <input v-model="mode" type="radio" :value="m" :disabled="busy" /> {{ m }}
      </label>
    </div>

    <div v-if="missingService && file" class="warn row">
      还没有配置{{ missingService }}，请先到设置中填写
      <button @click="emit('goSettings')">去设置</button>
    </div>

    <div v-if="job && phase !== 'drop'" class="card steps">
      <div v-for="s in job.steps" :key="s.id" class="step" :class="s.status">
        <span class="icon" aria-hidden="true">
          <Check v-if="s.status === 'done'" :size="16" />
          <LoaderCircle v-else-if="s.status === 'running'" class="spin" :size="16" />
          <X v-else-if="s.status === 'failed'" :size="16" />
          <Circle v-else :size="8" />
        </span>
        <span>{{ STEP_LABELS[s.id] }}</span>
        <span v-if="s.note" class="muted">{{ s.note }}</span>
        <span class="muted time">{{ elapsed(s) }}</span>
      </div>
      <div v-if="phase === 'failed' && error" class="failed">
        <p class="err">{{ error.message }}</p>
        <details v-if="error.detail">
          <summary>详细信息</summary>
          <pre>{{ error.detail }}</pre>
        </details>
        <div class="row">
          <button v-if="isAuthError" class="primary" @click="emit('goSettings')">去设置</button>
          <button :class="{ primary: !isAuthError }" @click="run">重试</button>
          <button @click="backToEdit">返回修改</button>
        </div>
      </div>
    </div>

    <div class="row actions">
      <button v-if="phase === 'processing'" @click="cancel">取消</button>
      <button v-else class="primary" :disabled="!file || !!missingService || busy" @click="start">
        开始处理 <span class="muted-on-primary">Ctrl+Enter</span>
      </button>
    </div>
  </main>
</template>

<style scoped>
/* 和确认页同一套：浅灰底上的白卡片，尺寸只用 src/style.css 的令牌 */
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--sp-5);
}
.card {
  margin-top: var(--sp-4);
  padding: var(--sp-5);
  background: var(--card);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}
.drop {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  background: var(--card);
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--panel-radius);
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--ease),
    background var(--ease);
}
.drop:hover:not(.disabled):not(.has),
.drop.dragging {
  border-color: var(--accent);
  background: var(--hover-soft);
}
.drop.disabled,
.drop.has {
  cursor: default;
}
.drop-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin-bottom: var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--chip-bg);
  color: var(--muted);
}
.drop p {
  margin: 0;
}
.big {
  margin-bottom: var(--sp-1);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.file {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.file-name {
  display: inline-flex;
  gap: var(--sp-2);
  align-items: center;
  font-weight: var(--fw-label);
  color: var(--fg-strong);
}
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
.options {
  margin-top: var(--sp-4);
  gap: var(--sp-4);
  color: var(--muted);
  font-weight: var(--fw-label);
}
.radio {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--fg);
  font-weight: normal;
  cursor: pointer;
}
.radio input {
  accent-color: var(--accent);
}
.warn {
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: var(--radius-md);
}
.steps .step {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-1) 0;
}
.icon {
  width: 16px;
  display: grid;
  place-items: center;
}
.step.pending {
  color: var(--faint);
}
.step.running {
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
.step.done .icon {
  color: var(--ok);
}
.step.failed .icon {
  color: var(--err);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.time {
  margin-left: auto;
}
.failed {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
.failed pre {
  white-space: pre-wrap;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.actions {
  margin-top: var(--sp-5);
  justify-content: flex-end;
}
.actions .primary {
  min-width: 160px;
}
.muted-on-primary {
  margin-left: var(--sp-1);
  opacity: 0.7;
  font-size: var(--fs-xs);
}
.err {
  color: var(--err);
}
.saved {
  margin-top: var(--sp-7);
  padding: var(--sp-7) var(--sp-5);
  text-align: center;
}
.saved-icon {
  color: var(--ok);
}
.saved-title {
  margin: var(--sp-3) 0 var(--sp-1);
  font-size: var(--fs-xl);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
.saved-path {
  margin: 0 0 var(--sp-5);
  overflow-wrap: anywhere;
}
.saved .row {
  justify-content: center;
}
.saved .row button {
  min-width: 120px;
}
</style>
