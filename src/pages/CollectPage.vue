<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { type Config, SERVICE_LABELS, isServiceConfigured, type ServiceKind } from '../core/config'
import { type Mode, MODES, type Prompts, type SourceType, preselectMode } from '../core/note'
import { type Job, newJob, runJob, STEP_LABELS } from '../core/pipeline'
import { describeError, isAppError, type ErrorCode } from '../core/errors'
import { httpFetch, listVaultTags, openNote } from '../shell/tauri'
import ConfirmPage from './ConfirmPage.vue'

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
      <p>
        ✓ 已保存到 <b>{{ savedPath }}</b>
      </p>
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
          <span>🎬 {{ file.name }}</span>
          <span class="muted">{{ (file.size / 1048576).toFixed(1) }} MB · {{ fileType }}</span>
          <button class="link danger" @click.stop="removeFile">移除</button>
        </div>
      </template>
      <template v-else>
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
        <span class="icon">{{
          s.status === 'done' ? '✓' : s.status === 'running' ? '◌' : s.status === 'failed' ? '✕' : '·'
        }}</span>
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
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
}
.drop {
  border: 2px dashed var(--line);
  border-radius: 10px;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--card);
  cursor: pointer;
  text-align: center;
  padding: 16px;
}
.drop.dragging {
  border-color: var(--primary);
}
.drop.disabled,
.drop.has {
  cursor: default;
}
.big {
  font-size: 18px;
  margin: 0 0 6px;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.file {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.options {
  margin-top: 16px;
  gap: 16px;
}
.radio {
  display: flex;
  gap: 4px;
  align-items: center;
}
.warn {
  margin-top: 12px;
  background: var(--warn-bg);
  border: 1px solid var(--warn);
  padding: 8px 12px;
  border-radius: 6px;
}
.steps .step {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  align-items: center;
}
.step.pending {
  color: var(--muted);
}
.step.running {
  font-weight: 600;
}
.step.done .icon {
  color: var(--ok);
}
.step.failed .icon {
  color: var(--err);
}
.time {
  margin-left: auto;
}
.failed {
  margin-top: 8px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
.failed pre {
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--muted);
}
.actions {
  margin-top: 16px;
  justify-content: flex-end;
}
.muted-on-primary {
  opacity: 0.7;
  font-size: 12px;
  margin-left: 4px;
}
.err {
  color: var(--err);
}
.saved p {
  font-size: 16px;
}
</style>
