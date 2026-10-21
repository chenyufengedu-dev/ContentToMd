<script setup lang="ts">
// 投放页：放入内容 → 处理中 / 失败 → 确认页 → 保存成功（方案第 6、11 节）。
// 一次只放一种内容：一个音视频文件，或者 1～9 张图片（文字和文档在 S1 后面几步接入）
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { type Config, SERVICE_LABELS, isServiceConfigured, type ServiceKind } from '../core/config'
import { type Mode, MODES, type Prompts, type SourceType, preselectMode } from '../core/note'
import { type Job, newImageJob, newJob, runJob, STEP_LABELS } from '../core/pipeline'
import { describeError, isAppError, type ErrorCode } from '../core/errors'
import { checkImages, MAX_IMAGES, readPixels, toAiDataUrl } from '../core/image'
import { httpFetch, listVaultTags, openNote } from '../shell/tauri'
import ConfirmPage from './ConfirmPage.vue'
import {
  Check,
  CircleCheck,
  Circle,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  PenLine,
  Plus,
  Upload,
  X,
} from 'lucide-vue-next'

const props = defineProps<{ config: Config; prompts: Prompts }>()
const emit = defineEmits<{ goSettings: [] }>()

type Phase = 'drop' | 'processing' | 'failed' | 'confirm' | 'saved'
const phase = ref<Phase>('drop')

// ---------------- 投放区 ----------------
const AUDIO = ['mp3', 'm4a', 'wav']
const VIDEO = ['mp4', 'mov']
const MAX_BYTES = 1024 ** 3 // 音视频 ≤ 1GB（方案第 11 节）
const MODE_ICONS = { 要点提炼: FileText, 原文精修: PenLine, 视觉收藏: ImageIcon }

const file = shallowRef<File | null>(null)
const fileType = ref<SourceType | null>(null)
/** 放入的图片；url 是缩略图用的本地地址，移除时释放 */
const images = ref<{ file: File; url: string }[]>([])
const source = ref('')
const errors = ref<string[]>([])
const mode = ref<Mode>('要点提炼')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()

const kind = computed<SourceType | null>(() => (images.value.length ? '图片' : fileType.value))
const hasContent = computed(() => !!kind.value)

function accept(files: File[]) {
  errors.value = []
  const media = files.filter((f) => !f.type.startsWith('image/'))
  const pics = files.filter((f) => f.type.startsWith('image/'))
  if (media.length) {
    if (pics.length || images.value.length || media.length > 1) {
      errors.value.push('一次只能放一个音视频文件，或者几张图片，不能混在一起')
      return
    }
    acceptMedia(media[0])
    return
  }
  if (file.value) {
    errors.value.push('已经放了一个音视频文件，要放图片请先移除它')
    return
  }
  const { accepted, rejected } = checkImages(images.value.length, pics)
  for (const r of rejected) errors.value.push(`“${r.name}”没有加入：${r.reason}`)
  if (!accepted.length) return
  images.value.push(...accepted.map((f) => ({ file: f, url: URL.createObjectURL(f) })))
  mode.value = preselectMode('图片')
}

function acceptMedia(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  const type: SourceType | null = VIDEO.includes(ext) ? '视频' : AUDIO.includes(ext) ? '音频' : null
  if (!type) {
    errors.value.push(
      `这一版还不支持 .${ext || '（无扩展名）'} 文件，目前能放入音视频（mp4、mov、mp3、m4a、wav）和图片`,
    )
    return
  }
  if (f.size > MAX_BYTES) {
    errors.value.push(`“${f.name}”超过 1GB，请压缩或截取后再放入`)
    return
  }
  file.value = f
  fileType.value = type
  mode.value = preselectMode(type)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (phase.value === 'drop' && e.dataTransfer) accept([...e.dataTransfer.files])
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  accept([...(input.files ?? [])])
  input.value = ''
}
/** Ctrl+V 粘贴截图；剪贴板里的图片没有像样的文件名，按顺序起名 */
function onPaste(e: ClipboardEvent) {
  if (phase.value !== 'drop') return
  const target = e.target as HTMLElement
  if (target.closest('input, textarea')) return // 正在输入链接时照常粘贴文字
  const files = [...(e.clipboardData?.files ?? [])]
  if (!files.length) return
  e.preventDefault()
  accept(
    files.map((f, i) =>
      f.type.startsWith('image/')
        ? new File([f], `粘贴的图片-${images.value.length + i + 1}.${f.type.split('/')[1] || 'png'}`, {
            type: f.type,
          })
        : f,
    ),
  )
}

function removeImage(i: number) {
  URL.revokeObjectURL(images.value[i].url)
  images.value.splice(i, 1)
  job.value = null
}
function clearContent() {
  images.value.forEach((x) => URL.revokeObjectURL(x.url))
  images.value = []
  file.value = null
  fileType.value = null
  source.value = ''
  errors.value = []
  job.value = null
}

const autoPicked = computed(() => kind.value && mode.value === preselectMode(kind.value))
const pickedHint = computed(() =>
  kind.value === '图片' ? '已按图片自动选择' : kind.value ? `已按${kind.value}自动选择` : '',
)

// 开始前检查需要的服务（方案第 8 节“没有配置所需服务”）
const missingService = computed<string | null>(() => {
  const need: ServiceKind[] = kind.value === '图片' ? ['vision'] : ['asr', 'text']
  const k = need.find((k) => !isServiceConfigured(props.config.services[k]))
  return k ? SERVICE_LABELS[k] : null
})

// ---------------- 处理 ----------------
const job = ref<Job | null>(null)
const error = ref<{ code?: ErrorCode; message: string; detail?: string } | null>(null)
const existingTags = ref<string[]>([])
let abort: AbortController | null = null
const now = ref(Date.now())
let ticker: number | undefined

const summary = computed(() => {
  if (images.value.length) return { name: `${images.value.length} 张图片`, info: `图片 · ${mode.value}` }
  if (file.value)
    return {
      name: file.value.name,
      info: `${(file.value.size / 1048576).toFixed(1)} MB · ${fileType.value} · ${mode.value}`,
    }
  return null
})

async function start() {
  if (!hasContent.value || missingService.value || phase.value !== 'drop') return
  // 取消后再开始：同样的内容、同一种整理方式时沿用已完成的步骤
  const same = job.value && job.value.mode === mode.value
  if (!same) {
    job.value = reactive(
      images.value.length
        ? newImageJob(
            images.value.map((x) => x.file),
            mode.value,
          )
        : newJob(file.value!.name, fileType.value!, mode.value),
    ) as Job
  }
  job.value!.source = source.value.trim()
  existingTags.value = await listVaultTags(props.config.vaultPath).catch(() => [])
  await run()
}

async function run() {
  if (!job.value) return
  const f = file.value
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
      readFile: () => f!.arrayBuffer(),
      toAiUrl: toAiDataUrl,
      readPixels,
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

/** 返回修改：保留放入的内容，丢掉这次的处理结果 */
function backToEdit() {
  job.value = null
  phase.value = 'drop'
}

const isAuthError = computed(() => error.value?.code === 'auth')
const failedStep = computed(() => job.value?.steps.find((s) => s.status === 'failed'))

function elapsed(s: { startedAt?: number; endedAt?: number }) {
  if (!s.startedAt) return ''
  return `${Math.round(((s.endedAt ?? now.value) - s.startedAt) / 1000)} 秒`
}

// ---------------- 保存后 ----------------
const savedPath = ref('')
const failedImages = ref<string[]>([])
function onSaved(rel: string, failed: string[]) {
  savedPath.value = rel
  failedImages.value = failed
  phase.value = 'saved'
}
const openError = ref<string | null>(null)
async function open() {
  openError.value = null
  await openNote(props.config.vaultPath, savedPath.value).catch((e) => (openError.value = String(e)))
}
function next() {
  clearContent()
  phase.value = 'drop'
}

// 快捷键：Ctrl+Enter 开始处理（方案第 11 节）
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter' && phase.value === 'drop') start()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('paste', onPaste)
  images.value.forEach((x) => URL.revokeObjectURL(x.url))
})
</script>

<template>
  <ConfirmPage
    v-if="phase === 'confirm' && job?.draft"
    :config="config"
    :job="job"
    :existing-tags="existingTags"
    @saved="onSaved"
    @discard="next"
  />

  <main v-else-if="phase === 'saved'" class="page">
    <div class="card saved">
      <CircleCheck class="saved-icon" :size="40" aria-hidden="true" />
      <p class="saved-title">已保存</p>
      <p class="muted saved-path">{{ savedPath }}</p>
      <p v-if="failedImages.length" class="err">
        笔记已保存，但有 {{ failedImages.length }} 张图片没有写入：{{ failedImages.join('、') }}
      </p>
      <div class="row">
        <button class="secondary" @click="open">打开</button>
        <button class="primary" @click="next">继续收藏</button>
      </div>
      <p v-if="openError" class="err">{{ openError }}</p>
    </div>
  </main>

  <!-- 处理中 / 失败：放入的内容缩成一行，下面是步骤 -->
  <main v-else-if="phase !== 'drop' && job" class="page">
    <div class="card">
      <div v-if="summary" class="summary-row">
        <component :is="kind === '图片' ? ImageIcon : FileVideo" :size="18" aria-hidden="true" />
        <span class="file-name">{{ summary.name }}</span>
        <span class="muted">{{ summary.info }}</span>
      </div>
      <div class="steps">
        <div v-for="s in job.steps" :key="s.id" class="step" :class="s.status">
          <span class="icon" aria-hidden="true">
            <Check v-if="s.status === 'done'" :size="16" />
            <LoaderCircle v-else-if="s.status === 'running'" class="spin" :size="16" />
            <X v-else-if="s.status === 'failed'" :size="16" />
            <Circle v-else :size="8" />
          </span>
          <span>{{ STEP_LABELS[s.id] }}</span>
          <span v-if="s.note" class="muted">{{ s.note }}</span>
          <span class="muted time">{{ s.status === 'failed' ? '失败' : elapsed(s) }}</span>
        </div>
      </div>
      <div v-if="phase === 'failed' && error" class="failed">
        <p class="failed-msg">{{ error.message }}</p>
        <details v-if="error.detail">
          <summary>详细信息</summary>
          <pre>{{ error.detail }}</pre>
        </details>
      </div>
      <div class="row actions">
        <template v-if="phase === 'processing'">
          <button class="secondary" @click="cancel">取消</button>
        </template>
        <template v-else>
          <span v-if="failedStep" class="muted retry-hint"
            >从“{{ STEP_LABELS[failedStep.id] }}”这一步重新开始，前面的步骤不用重做</span
          >
          <button class="secondary" @click="backToEdit">返回修改</button>
          <button v-if="isAuthError" class="primary" @click="emit('goSettings')">去设置</button>
          <button v-else class="primary" @click="run">重试</button>
        </template>
      </div>
    </div>
  </main>

  <!-- 投放 -->
  <main v-else class="page">
    <div class="card" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
      <div v-if="images.length" class="thumbs">
        <figure v-for="(img, i) in images" :key="img.url" class="thumb">
          <img :src="img.url" :alt="img.file.name" />
          <button class="thumb-x" :aria-label="`移除 ${img.file.name}`" @click="removeImage(i)">
            <X :size="14" />
          </button>
        </figure>
        <button
          v-if="images.length < MAX_IMAGES"
          class="thumb-add"
          :class="{ dragging }"
          aria-label="继续添加图片"
          @click="fileInput?.click()"
        >
          <Plus :size="22" />
        </button>
      </div>
      <p v-if="images.length" class="muted hint">可以继续粘贴或拖入图片，最多 {{ MAX_IMAGES }} 张，单张不超过 20MB</p>

      <div v-else-if="file" class="summary-row media">
        <FileVideo :size="18" aria-hidden="true" />
        <span class="file-name">{{ file.name }}</span>
        <span class="muted">{{ (file.size / 1048576).toFixed(1) }} MB · {{ fileType }}</span>
        <button class="link danger" @click="clearContent">移除</button>
      </div>

      <button v-else class="drop" :class="{ dragging }" @click="fileInput?.click()">
        <span class="drop-icon"><Upload :size="24" aria-hidden="true" /></span>
        <span class="big">拖入或粘贴内容</span>
        <span class="muted">支持音视频（mp4、mov、mp3、m4a、wav）和截图（Ctrl+V 粘贴）</span>
      </button>
      <input ref="fileInput" type="file" multiple accept=".mp4,.mov,.mp3,.m4a,.wav,image/*" hidden @change="onPick" />
      <p v-for="e in errors" :key="e" class="err">{{ e }}</p>

      <label v-if="images.length" class="field">
        <span class="field-label">来源链接<span class="muted">（选填）</span></span>
        <span class="link-input">
          <Link2 :size="16" aria-hidden="true" />
          <input v-model="source" placeholder="粘贴来源网址" spellcheck="false" />
        </span>
      </label>

      <div class="field">
        <span class="field-label">整理方式</span>
        <div class="modes">
          <button
            v-for="m in MODES"
            :key="m"
            class="mode"
            :class="{ on: mode === m }"
            :aria-pressed="mode === m"
            @click="mode = m"
          >
            <component :is="MODE_ICONS[m]" :size="16" aria-hidden="true" />{{ m }}
          </button>
          <span v-if="autoPicked" class="muted">{{ pickedHint }}</span>
        </div>
      </div>

      <div v-if="missingService && hasContent" class="warn row">
        还没有配置{{ missingService }}，请先到设置中填写
        <button class="secondary" @click="emit('goSettings')">去设置</button>
      </div>

      <div class="row actions">
        <button class="primary start" :disabled="!hasContent || !!missingService" @click="start">
          开始处理 <span class="muted-on-primary">Ctrl+Enter</span>
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 和确认页同一套：浅灰底上的白卡片，尺寸只用 src/style.css 的令牌 */
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--sp-7) var(--sp-5) var(--sp-5);
}
.card {
  padding: var(--sp-6);
  background: var(--card);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.err {
  margin: var(--sp-2) 0 0;
  color: var(--err);
  font-size: var(--fs-sm);
}
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
button.secondary {
  border: 0;
  background: var(--hover);
}
button.secondary:hover:not(:disabled) {
  background: var(--line);
}

/* ---- 空白时的大投放区 ---- */
.drop {
  width: 100%;
  height: auto;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: none;
  transition:
    border-color var(--ease),
    background var(--ease);
}
.drop:hover:not(:disabled),
.drop.dragging {
  border-color: var(--accent);
  background: var(--hover-soft);
}
.drop-icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  margin-bottom: var(--sp-2);
  border-radius: var(--radius-md);
  background: var(--chip-bg);
  color: var(--muted);
}
.big {
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}

/* ---- 已放入的图片 ---- */
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.thumb {
  position: relative;
  margin: 0;
  width: 132px;
  height: 132px;
  border-radius: var(--radius-md);
  background: var(--card-muted);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.thumb-x {
  position: absolute;
  top: var(--sp-1);
  right: var(--sp-1);
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--card);
  color: var(--muted);
  box-shadow: var(--shadow-card);
  display: grid;
  place-items: center;
}
.thumb-add {
  width: 132px;
  height: 132px;
  padding: 0;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: none;
  color: var(--faint);
  display: grid;
  place-items: center;
}
.thumb-add:hover:not(:disabled),
.thumb-add.dragging {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--hover-soft);
}
.hint {
  margin: var(--sp-3) 0 0;
}

/* ---- 一行的内容摘要（音视频文件，或处理中） ---- */
.summary-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
}
.summary-row.media {
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.summary-row .link {
  margin-left: auto;
}
.file-name {
  font-weight: var(--fw-label);
  color: var(--fg-strong);
}

/* ---- 表单 ---- */
.field {
  display: block;
  margin-top: var(--sp-5);
}
.field-label {
  display: block;
  margin-bottom: var(--sp-2);
  font-weight: var(--fw-label);
  color: var(--fg-strong);
}
.link-input {
  height: var(--h-md);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--px-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  color: var(--faint);
  transition:
    border-color var(--ease),
    box-shadow var(--ease);
}
.link-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.link-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--fg);
}
.modes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.mode {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 120px;
  justify-content: center;
  border: 1px solid transparent;
  background: var(--card-muted);
  color: var(--fg);
}
.mode:hover:not(:disabled) {
  background: var(--hover);
}
.mode.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--fw-label);
}
.warn {
  margin-top: var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: var(--radius-md);
}
.actions {
  margin-top: var(--sp-5);
  justify-content: flex-end;
}
.start {
  min-width: 160px;
}
.muted-on-primary {
  margin-left: var(--sp-1);
  opacity: 0.7;
  font-size: var(--fs-xs);
}
.retry-hint {
  margin-right: auto;
}

/* ---- 处理步骤 ---- */
.steps {
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
.step {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-2) 0;
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
.step.running .icon {
  color: var(--accent);
}
.step.done .icon {
  color: var(--ok);
}
.step.failed .icon,
.step.failed .time {
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
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.failed-msg {
  margin: 0;
  color: var(--fg-strong);
}
.failed details {
  margin-top: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.failed pre {
  white-space: pre-wrap;
  font-size: var(--fs-xs);
}

/* ---- 保存成功 ---- */
.saved {
  max-width: 480px;
  margin: var(--sp-7) auto 0;
  padding: var(--sp-7) var(--sp-6);
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
  flex: 1;
}
</style>
