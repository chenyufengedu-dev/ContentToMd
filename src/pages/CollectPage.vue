<script setup lang="ts">
// 投放页：放入内容 → 处理中 / 失败 → 确认页 → 保存成功（方案第 6、11 节）。
// 一次只放一种内容：一个音视频文件、一个 MD / TXT 文件，或者 1～9 张图片（设计稿 设计稿/投放页/*.webp）
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { type Config, SERVICE_LABELS, isServiceConfigured, type ServiceKind } from '../core/config'
import { type Mode, MODES, type Prompts, type SourceType, preselectMode } from '../core/note'
import { type Job, newImageJob, newJob, newTextJob, runJob } from '../core/pipeline'
import { parseShareText, type ShareInfo } from '../core/shareText'
import { decodeText } from '../core/textFile'
import { describeError, isAppError, type ErrorCode } from '../core/errors'
import { checkImages, MAX_IMAGES, readPixels, toAiDataUrl } from '../core/image'
import { httpFetch, listVaultTags, openNote } from '../shell/tauri'
import ConfirmPage, { type SavedNote } from './ConfirmPage.vue'
import SavedView from '../components/SavedView.vue'
import ProcessingView from '../components/ProcessingView.vue'
import {
  CircleAlert,
  FilePlus2,
  FileText,
  FileAudio,
  Image as ImageIcon,
  Link2,
  PenLine,
  Plus,
  X,
} from 'lucide-vue-next'

const props = defineProps<{ config: Config; prompts: Prompts }>()
const emit = defineEmits<{ goSettings: [] }>()

type Phase = 'drop' | 'processing' | 'failed' | 'confirm' | 'saved'
const phase = ref<Phase>('drop')

// ---------------- 投放区 ----------------
const AUDIO = ['mp3', 'm4a', 'wav']
const VIDEO = ['mp4', 'mov']
const TEXT = ['md', 'txt']
const MAX_BYTES = 1024 ** 3 // 音视频 ≤ 1GB（方案第 11 节）
const MAX_TEXT_BYTES = 10 * 1024 ** 2
const MODE_ICONS = { 要点提炼: FileText, 原文精修: PenLine, 视觉收藏: ImageIcon }
/** 缩略图下面的时长：5:12 */
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const file = shallowRef<File | null>(null)
const fileType = ref<SourceType | null>(null)
/** 音视频的本地地址（缩略图取第一帧）和时长 */
const fileUrl = ref('')
const duration = ref<number | null>(null)
/** 放入的 MD / TXT：放入时就解出文字（F07），认不出编码的不加入 */
const textFile = shallowRef<{ name: string; text: string; encoding: string } | null>(null)
/** 放入的图片；url 是缩略图用的本地地址，移除时释放 */
const images = ref<{ file: File; url: string }[]>([])
/** 来源框里显示的文字；粘贴分享文字后换成认出的链接（F02） */
const source = ref('')
/** 认出的分享文字：原文、平台、作者。“改回原文”时清掉 */
const share = ref<(ShareInfo & { raw: string }) | null>(null)
const request = ref('')
const REQUEST_MAX = 500
const errors = ref<string[]>([])
const mode = ref<Mode>('要点提炼')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()

const kind = computed<SourceType | null>(() =>
  images.value.length ? '图片' : textFile.value ? '文字' : fileType.value,
)
const hasContent = computed(() => !!kind.value)

function accept(files: File[]) {
  errors.value = []
  const media = files.filter((f) => !f.type.startsWith('image/'))
  const pics = files.filter((f) => f.type.startsWith('image/'))
  if (media.length) {
    if (pics.length || images.value.length || media.length > 1) {
      errors.value.push('一次只能放一个文件，或者几张图片，不能混在一起')
      return
    }
    acceptFile(media[0])
    return
  }
  if (file.value || textFile.value) {
    errors.value.push('已经放了一个文件，要放图片请先移除它')
    return
  }
  const { accepted, rejected } = checkImages(images.value.length, pics)
  for (const r of rejected) errors.value.push(`“${r.name}”没有加入：${r.reason}`)
  if (!accepted.length) return
  images.value.push(...accepted.map((f) => ({ file: f, url: URL.createObjectURL(f) })))
  mode.value = preselectMode('图片')
}

function acceptFile(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  if (TEXT.includes(ext)) {
    void acceptText(f)
    return
  }
  const type: SourceType | null = VIDEO.includes(ext) ? '视频' : AUDIO.includes(ext) ? '音频' : null
  if (!type) {
    errors.value.push(`暂不支持 .${ext || '（无扩展名）'} 文件。支持：图片、mp3 / m4a / wav、mp4 / mov、md / txt`)
    return
  }
  if (f.size > MAX_BYTES) {
    errors.value.push(`“${f.name}”超过 1GB，请压缩或截取后再放入`)
    return
  }
  file.value = f
  fileType.value = type
  fileUrl.value = URL.createObjectURL(f)
  duration.value = null
  mode.value = preselectMode(type)
}

/** MD / TXT：认不出编码或是空文件时不加入（方案第 8 节） */
async function acceptText(f: File) {
  if (f.size > MAX_TEXT_BYTES) {
    errors.value.push(`“${f.name}”超过 10MB，请截取后再放入`)
    return
  }
  const decoded = decodeText(await f.arrayBuffer())
  if (!decoded) {
    errors.value.push(`${f.name} 没有加入：文件编码无法识别，请另存为 UTF-8 后重试`)
    return
  }
  if (!decoded.text.trim()) {
    errors.value.push(`${f.name} 没有加入：无法读取，可能已损坏或内容为空`)
    return
  }
  textFile.value = { name: f.name, text: decoded.text, encoding: decoded.encoding }
  mode.value = preselectMode('文字')
}

/** 来源框粘贴：是分享文字就换成链接，平台、作者显示在下面（F02）。只在本地拆文字，不联网 */
function onSourcePaste(e: ClipboardEvent) {
  const raw = e.clipboardData?.getData('text') ?? ''
  const info = parseShareText(raw)
  if (!info || raw.trim() === info.url) return
  e.preventDefault()
  source.value = info.url
  share.value = { ...info, raw: raw.trim() }
}
function restoreShareText() {
  if (!share.value) return
  source.value = share.value.raw
  share.value = null
}
/** 手动改了链接，认出的平台、作者就不再算数 */
function onSourceInput() {
  if (share.value && source.value.trim() !== share.value.url) share.value = null
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
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
  fileUrl.value = ''
  file.value = null
  fileType.value = null
  textFile.value = null
  source.value = ''
  share.value = null
  request.value = ''
  errors.value = []
  job.value = null
}

const autoPicked = computed(() => kind.value && mode.value === preselectMode(kind.value))
const pickedHint = computed(() =>
  kind.value === '图片' ? '已按截图自动选择' : kind.value ? `已按${kind.value}自动选择` : '',
)

/** 文件那一行的灰字：时长 · 大小，或者 字数 · 编码 */
const itemInfo = computed(() =>
  textFile.value
    ? `${textFile.value.text.length.toLocaleString()} 字 · ${textFile.value.encoding} 编码`
    : [
        duration.value ? fmtDuration(duration.value) : '',
        file.value ? `${(file.value.size / 1048576).toFixed(0)} MB` : '',
      ]
        .filter(Boolean)
        .join(' · '),
)

// 开始前检查需要的服务（方案第 8 节“没有配置所需服务”）
const missingService = computed<string | null>(() => {
  const need: ServiceKind[] = kind.value === '图片' ? ['vision'] : kind.value === '文字' ? ['text'] : ['asr', 'text']
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
  if (images.value.length) return { name: `${images.value.length} 张图片`, info: mode.value }
  if (textFile.value)
    return { name: textFile.value.name, info: `${textFile.value.text.length.toLocaleString()} 字 · ${mode.value}` }
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
        : textFile.value
          ? newTextJob(textFile.value.name, textFile.value.text, mode.value)
          : newJob(file.value!.name, fileType.value!, mode.value),
    ) as Job
  }
  Object.assign(job.value!, {
    source: source.value.trim(),
    shareText: share.value?.raw ?? '',
    platform: share.value?.platform ?? '',
    author: share.value?.author ?? '',
    request: request.value.trim(),
  })
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

// ---------------- 保存后 ----------------
const saved = ref<SavedNote | null>(null)
const vaultName = computed(() => props.config.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '收藏库')
function onSaved(note: SavedNote) {
  saved.value = note
  phase.value = 'saved'
}
const openError = ref<string | null>(null)
async function open() {
  openError.value = null
  await openNote(props.config.vaultPath, saved.value!.path).catch((e) => (openError.value = String(e)))
}
function next() {
  clearContent()
  phase.value = 'drop'
}

// 快捷键：Ctrl+Enter 开始处理（方案第 11 节）
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey && e.key === 'Enter')) return
  if (phase.value === 'drop') start()
  else if (phase.value === 'saved') next()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('paste', onPaste)
  images.value.forEach((x) => URL.revokeObjectURL(x.url))
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
})
</script>

<template>
  <ConfirmPage
    v-if="phase === 'confirm' && job?.draft"
    :config="config"
    :job="job"
    :existing-tags="existingTags"
    @saved="onSaved"
    @go-settings="emit('goSettings')"
    @discard="next"
  />

  <main v-else-if="phase === 'saved' && saved" class="page proc-page">
    <SavedView :note="saved" :vault-name="vaultName" :open-error="openError" @open="open" @next="next" />
  </main>

  <!-- 处理中 / 失败 -->
  <main v-else-if="phase !== 'drop' && job && summary" class="page proc-page">
    <ProcessingView
      :job="job"
      :failed="phase === 'failed'"
      :summary="summary"
      :error="error"
      :now="now"
      @cancel="cancel"
      @retry="run"
      @back="backToEdit"
      @go-settings="emit('goSettings')"
    />
  </main>

  <!-- 投放（设计稿 设计稿/投放页/基准-已放视频.webp 和 状态-*.webp）：只有一张白卡片，里面不套卡片、输入框不带边框 -->
  <main v-else class="page">
    <div class="card" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
      <template v-if="images.length">
        <div class="thumbs">
          <figure v-for="(img, i) in images" :key="img.url" class="thumb">
            <img :src="img.url" :alt="img.file.name" />
            <button class="thumb-x" :aria-label="`移除 ${img.file.name}`" @click="removeImage(i)">
              <X :size="12" />
            </button>
          </figure>
          <button
            v-if="images.length < MAX_IMAGES"
            class="thumb thumb-add"
            :class="{ dragging }"
            aria-label="继续添加图片"
            @click="fileInput?.click()"
          >
            <Plus :size="20" />
          </button>
        </div>
        <p class="hint">可以继续粘贴或拖入，最多 {{ MAX_IMAGES }} 张，单张不超过 20MB</p>
      </template>

      <div v-else-if="file || textFile" class="item">
        <video
          v-if="fileType === '视频'"
          class="thumb"
          :src="`${fileUrl}#t=0.1`"
          muted
          preload="auto"
          @loadedmetadata="duration = ($event.target as HTMLVideoElement).duration"
        />
        <span v-else class="thumb thumb-icon">
          <component :is="textFile ? FileText : FileAudio" :size="22" aria-hidden="true" />
        </span>
        <span class="item-text">
          <span class="item-name">{{ textFile?.name ?? file!.name }}</span>
          <span class="item-info">{{ itemInfo }}</span>
        </span>
        <button class="icon-x" aria-label="移除" @click="clearContent"><X :size="16" /></button>
      </div>

      <button v-else class="drop" :class="{ dragging }" @click="fileInput?.click()">
        <FilePlus2 :size="26" aria-hidden="true" />
        <span class="big">拖入或粘贴内容</span>
        <span class="hint">支持音视频、截图、md / txt</span>
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".mp4,.mov,.mp3,.m4a,.wav,.md,.txt,image/*"
        hidden
        @change="onPick"
      />
      <p v-for="e in errors" :key="e" class="notice">
        <CircleAlert :size="15" aria-hidden="true" /><span>{{ e }}</span>
        <button class="icon-x" aria-label="关闭提示" @click="errors = errors.filter((x) => x !== e)">
          <X :size="14" />
        </button>
      </p>

      <label class="field">
        <span class="field-label">来源</span>
        <span class="input link-input">
          <Link2 v-if="!source" :size="16" aria-hidden="true" />
          <input
            v-model="source"
            placeholder="粘贴链接或分享文字（选填）"
            spellcheck="false"
            @paste="onSourcePaste"
            @input="onSourceInput"
          />
        </span>
      </label>
      <p v-if="share" class="share">
        <span>{{ [share.platform, share.author && `@${share.author}`].filter(Boolean).join(' · ') }}</span>
        <span class="share-from">已从分享文字识别</span>
        <button class="link" @click="restoreShareText">改回原文</button>
      </p>

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
          <span v-if="autoPicked" class="hint">{{ pickedHint }}</span>
        </div>
      </div>

      <label class="field">
        <span class="field-label">本次要求（选填）</span>
        <span class="input textarea">
          <textarea
            v-model="request"
            rows="3"
            :maxlength="REQUEST_MAX"
            placeholder="比如：重点写可借鉴的做法 / 只要三句话总结"
          />
          <span class="count">{{ request.length }}/{{ REQUEST_MAX }}</span>
        </span>
      </label>

      <p v-if="missingService && hasContent" class="notice">
        <CircleAlert :size="15" aria-hidden="true" /><span>还没有配置{{ missingService }}，请先到设置中填写</span>
        <button class="link" @click="emit('goSettings')">去设置</button>
      </p>

      <div class="actions">
        <button class="primary start" :disabled="!hasContent || !!missingService" @click="start">
          开始处理 <span class="muted-on-primary">Ctrl+Enter</span>
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 投放页：一张白卡片，分组只靠留白和灰色小标题；尺寸只用 src/style.css 的令牌 */
.page {
  max-width: 680px;
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
.hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--faint);
}

/* ---- 空白时的投放区：浅灰底，无边框 ---- */
.drop {
  width: 100%;
  height: auto;
  min-height: 168px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--card-muted);
  color: var(--muted);
  transition: background var(--ease);
}
.drop:hover:not(:disabled),
.drop.dragging {
  background: var(--hover);
}
.drop .big {
  margin-top: var(--sp-2);
  font-size: var(--fs-md);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}

/* ---- 已放入的文件：缩略图 + 文件名 + 一行灰字 ---- */
.item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
.thumb {
  position: relative;
  flex: none;
  width: 64px;
  height: 64px;
  margin: 0;
  border-radius: var(--radius-md);
  background: var(--card-muted);
  object-fit: cover;
  overflow: hidden;
}
.thumb-icon {
  display: grid;
  place-items: center;
  color: var(--muted);
}
.item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item-name {
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-info {
  font-size: var(--fs-sm);
  color: var(--faint);
}
.icon-x {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--faint);
}
.icon-x:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg);
}

/* ---- 已放入的图片 ---- */
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.thumb-x {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
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
  padding: 0;
  border: 0;
  display: grid;
  place-items: center;
  color: var(--faint);
}
.thumb-add:hover:not(:disabled),
.thumb-add.dragging {
  background: var(--hover);
  color: var(--fg);
}
.thumbs + .hint {
  margin-top: var(--sp-3);
}

/* ---- 一行提示（没加入的文件、没配置的服务）：没有底色和边框 ---- */
.notice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-sm);
  color: var(--fg);
}
.notice > svg:first-child {
  flex: none;
  color: var(--warn);
}
.notice span {
  flex: 1;
  min-width: 0;
}
.notice .link {
  font-size: inherit;
}

/* ---- 表单：灰色小标题，输入框浅灰底无边框，获得焦点时一圈淡靛蓝 ---- */
.field {
  display: block;
  margin-top: var(--sp-5);
}
.field-label {
  display: block;
  margin-bottom: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.input {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--px-sm);
  border-radius: var(--radius-md);
  background: var(--card-muted);
  color: var(--faint);
  transition:
    background var(--ease),
    box-shadow var(--ease);
}
.input:focus-within {
  background: var(--card);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}
.input input,
.input textarea {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--fg);
}
.input input::placeholder,
.input textarea::placeholder {
  color: var(--faint);
}
.link-input {
  height: var(--h-md);
}
.textarea {
  position: relative;
  align-items: stretch;
  padding: var(--sp-3) var(--px-sm) var(--sp-5);
}
.textarea textarea {
  resize: none;
  line-height: 1.6;
}
.count {
  position: absolute;
  right: var(--px-sm);
  bottom: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--faint);
}
.share {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sm);
  color: var(--muted);
}
.share-from {
  margin-left: auto;
  color: var(--faint);
}
.share .link {
  padding: 0;
  font-size: inherit;
}

/* ---- 整理方式：一排小胶囊；没选中浅灰底灰字，选中白底微浮、靛蓝字 ---- */
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
  border: 0;
  background: var(--card-muted);
  color: var(--muted);
}
.mode:hover:not(:disabled) {
  background: var(--hover);
}
.mode.on,
.mode.on:hover:not(:disabled) {
  background: var(--card);
  color: var(--accent);
  font-weight: var(--fw-label);
  box-shadow:
    0 0 0 1px var(--line),
    var(--shadow-card);
}
.modes .hint {
  margin-left: var(--sp-2);
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--sp-5);
}
.muted-on-primary {
  margin-left: var(--sp-1);
  opacity: 0.7;
  font-size: var(--fs-xs);
  font-weight: 400;
}

/* ---- 处理中：主体小、四周留白多（设计稿 定稿-处理中-*.webp） ---- */
.proc-page {
  max-width: 820px;
  padding-top: var(--sp-7);
}
</style>
