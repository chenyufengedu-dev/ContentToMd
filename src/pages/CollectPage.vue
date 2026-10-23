<script setup lang="ts">
// 投放页：放入内容 → 处理中 / 失败 → 确认页 → 保存成功（方案第 6、11 节）。
// 一次只放一种内容：一个音视频文件、一个 MD / TXT 文件，或者 1～9 张图片（设计稿 设计稿/投放页/*.webp）
import { vPress } from '../components/pressFeedback'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import {
  type Config,
  SERVICE_LABELS,
  isServiceConfigured,
  notesRoot,
  storeLabel,
  type ServiceKind,
} from '../core/config'
import { type Mode, MODES, type NoteDraft, type Prompts, type SourceType, preselectMode } from '../core/note'
import { type Job, newImageJob, newJob, newTextJob, runJob } from '../core/pipeline'
import { parseShareText, type ShareInfo } from '../core/shareText'
import { decodeText } from '../core/textFile'
import FileTypeIcon from '../components/FileTypeIcon.vue'
import { kindOfName, type FileKind } from '../components/fileKind'
import { isScanned, LONG_TEXT_CHARS, readDocx, readPdf, setPdfWorker } from '../core/docText'
import { estimateWait, lengthProblem, MAX_CHARS } from '../core/longText'
import { importFailed } from '../core/importMessages'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { describeError, isAppError, type ErrorCode } from '../core/errors'
import { checkImages, MAX_IMAGES, readPixels, toAiDataUrl } from '../core/image'
import {
  appendUsage,
  clearDraft,
  destroyWindow,
  guardClose,
  httpFetch,
  listVaultTags,
  loadDraft,
  saveDraft,
} from '../shell/tauri'
import { fromDraft, type DraftData } from '../core/draft'
import NoticeDialog from '../components/NoticeDialog.vue'
import ConfirmPage, { type SavedNote } from './ConfirmPage.vue'
import SavedView from '../components/SavedView.vue'
import ProcessingView from '../components/ProcessingView.vue'
import {
  CircleAlert,
  Clock,
  FilePlus2,
  FileText,
  Image as ImageIcon,
  Link2,
  PenLine,
  Plus,
  X,
} from '../components/icons'

const props = defineProps<{ config: Config; prompts: Prompts }>()
const emit = defineEmits<{ goSettings: []; configChanged: [Config]; openNote: [path: string] }>()

type Phase = 'drop' | 'processing' | 'failed' | 'confirm' | 'saved'
const phase = ref<Phase>('drop')

// ---------------- 投放区 ----------------
const AUDIO = ['mp3', 'm4a', 'wav']
const VIDEO = ['mp4', 'mov']
const TEXT = ['md', 'txt']
const DOC = ['pdf', 'docx']
const MAX_DOC_BYTES = 50 * 1024 ** 2
/** 投放区底下列出的支持类型 */
const SUPPORTED: { kind: FileKind; label: string }[] = [
  { kind: 'video', label: '音视频' },
  { kind: 'image', label: '截图' },
  { kind: 'md', label: 'md / txt' },
  { kind: 'pdf', label: 'pdf' },
  { kind: 'docx', label: 'docx' },
]
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
/** 放入的 MD / TXT / PDF / Word：放入时就解出文字（F07、F15、F16），认不出的不加入 */
const textFile = shallowRef<{
  name: string
  text: string
  type: SourceType
  encoding?: string
  pages?: number
} | null>(null)
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
  images.value.length ? '图片' : textFile.value ? textFile.value.type : fileType.value,
)
const hasContent = computed(() => !!kind.value)

function accept(files: File[]) {
  errors.value = []
  const media = files.filter((f) => !f.type.startsWith('image/'))
  const pics = files.filter((f) => f.type.startsWith('image/'))
  if (media.length) {
    if (pics.length || images.value.length || media.length > 1) {
      errors.value.push('一次只能放一个文件，或者几张图片，不能混在一起。')
      return
    }
    acceptFile(media[0])
    return
  }
  if (file.value || textFile.value) {
    errors.value.push('已经放了一个文件。要放图片，请先移除它。')
    return
  }
  const { accepted, rejected } = checkImages(images.value.length, pics)
  for (const r of rejected) errors.value.push(importFailed(r.name, r.reason))
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
  if (DOC.includes(ext)) {
    void acceptDoc(f, ext)
    return
  }
  const type: SourceType | null = VIDEO.includes(ext) ? '视频' : AUDIO.includes(ext) ? '音频' : null
  if (!type) {
    errors.value.push(
      `不支持 .${ext || '（无扩展名）'} 文件。目前支持：图片、mp3 / m4a / wav、mp4 / mov、md / txt、pdf / docx。`,
    )
    return
  }
  if (f.size > MAX_BYTES) {
    errors.value.push(importFailed(f.name, '文件太大，超过了 1GB 的上限。请压缩或截取后再放入。'))
    return
  }
  file.value = f
  fileType.value = type
  fileUrl.value = URL.createObjectURL(f)
  duration.value = null
  mode.value = preselectMode(type)
  probeMedia(f, type)
}

/** 放入音视频时先让浏览器内核试着读一下：读不出来的格式（比如部分 H.265 视频）现在就说，不等到“提取声音”那一步才报错 */
function probeMedia(f: File, type: SourceType) {
  const el = document.createElement(type === '视频' ? 'video' : 'audio')
  el.preload = 'metadata'
  el.onerror = () => {
    if (file.value !== f) return // 用户已经移除或换了别的文件
    clearContent(true)
    errors.value.push(
      importFailed(
        f.name,
        type === '视频'
          ? '这个视频的格式无法读取。请转换成 mp4 后再放入。'
          : '这个音频的格式无法读取。请转换成 mp3 后再放入。',
      ),
    )
  }
  el.src = fileUrl.value
}

/** MD / TXT：认不出编码或是空文件时不加入（方案第 8 节） */
async function acceptText(f: File) {
  if (f.size > MAX_TEXT_BYTES) {
    errors.value.push(importFailed(f.name, '文件太大，超过了 10MB 的上限。请截取后再放入。'))
    return
  }
  const decoded = decodeText(await f.arrayBuffer())
  if (!decoded) {
    errors.value.push(importFailed(f.name, '无法识别文件编码。请另存为 UTF-8 后重试。'))
    return
  }
  if (!decoded.text.trim()) {
    errors.value.push(importFailed(f.name, '文件无法读取，可能已损坏或内容为空。'))
    return
  }
  if (tooLongToAccept(f.name, decoded.text)) return
  textFile.value = { name: f.name, text: decoded.text, type: '文字', encoding: decoded.encoding }
  mode.value = defaultMode('文字', decoded.text.length)
}

/** 超过要点提炼的上限（8 万字）的内容哪种方式都装不下，不加入 */
function tooLongToAccept(name: string, text: string): boolean {
  const problem = lengthProblem('要点提炼', text.length)
  if (problem) errors.value.push(importFailed(name, problem))
  return !!problem
}

/** 预选整理方式；文字超过原文精修的上限（2 万字）时改选要点提炼 */
const defaultMode = (type: SourceType, chars: number): Mode =>
  chars > MAX_CHARS.原文精修 ? '要点提炼' : preselectMode(type)

/** PDF / Word：只取文字（F15、F16）；扫描版、有密码、读不出的不加入（方案 US7） */
async function acceptDoc(f: File, ext: string) {
  if (f.size > MAX_DOC_BYTES) {
    errors.value.push(importFailed(f.name, '文件太大，超过了 50MB 的上限。请截取后再放入。'))
    return
  }
  try {
    setPdfWorker(pdfWorker)
    const buf = await f.arrayBuffer()
    const doc = await (ext === 'pdf' ? readPdf(buf) : readDocx(buf))
    if (ext === 'pdf' && isScanned(doc)) {
      errors.value.push(importFailed(f.name, '这是扫描版 PDF，里面没有可读的文字。可以截图后放入。'))
      return
    }
    if (!doc.text.trim()) {
      errors.value.push(importFailed(f.name, '文件无法读取，可能已损坏或内容为空。'))
      return
    }
    if (tooLongToAccept(f.name, doc.text)) return
    textFile.value = { name: f.name, text: doc.text, type: '文档', pages: doc.pages }
    mode.value = defaultMode('文档', doc.text.length)
  } catch (e) {
    const locked = e instanceof Error && e.name === 'PasswordException'
    errors.value.push(
      locked
        ? importFailed(f.name, '文件有密码。请先取消密码再放入。')
        : importFailed(f.name, '文件无法读取，可能已损坏。'),
    )
  }
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
/** keepDraftFile：从草稿恢复前清空界面时，不能把草稿也删了 */
function clearContent(keepDraftFile = false) {
  longOk = false
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
  if (!keepDraftFile) dropDraft()
}

// 草稿（F10）：任务开始、每一步做完、停下来时存；保存成功、放弃、移除内容时删。存不了不打断处理
const keepDraft = (withFiles = false) => job.value && void saveDraft(job.value, withFiles).catch(() => {})
const dropDraft = () => void clearDraft().catch(() => {})

const autoPicked = computed(() => kind.value && mode.value === preselectMode(kind.value))

/** 文件那一行的灰字：时长 · 大小，或者 字数 · 编码 */
const itemInfo = computed(() =>
  textFile.value
    ? [
        `${textFile.value.text.length.toLocaleString()} 字`,
        textFile.value.pages && `${textFile.value.pages} 页`,
        textFile.value.encoding && `${textFile.value.encoding} 编码`,
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        duration.value ? fmtDuration(duration.value) : '',
        file.value ? `${(file.value.size / 1048576).toFixed(0)} MB` : '',
      ]
        .filter(Boolean)
        .join(' · '),
)

// 开始前检查需要的服务（方案第 8 节“没有配置所需服务”）
const missingService = computed<string | null>(() => {
  const need: ServiceKind[] =
    kind.value === '图片' ? ['vision'] : kind.value === '文字' || kind.value === '文档' ? ['text'] : ['asr', 'text']
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
  // 从草稿接着处理的音视频：已经转写完，原文件不在了
  if (job.value) return { name: job.value.fileName, info: `${job.value.type} · ${mode.value}` }
  return null
})

/** 选中的整理方式装不下这份文字时的说明（原文精修最多 2 万字），有的话不能开始 */
const lengthNotice = computed(() => (textFile.value ? lengthProblem(mode.value, textFile.value.text.length) : null))

/** 内容比较长时的等待时间提示（不挡着开始） */
const waitNotice = computed(() => (textFile.value ? estimateWait(mode.value, textFile.value.text.length) : null))

/** 文字超过 8000 字时先问一句（方案 US7），确认过就不再问 */
const askLong = ref(false)
let longOk = false
async function start() {
  if (!hasContent.value || missingService.value || lengthNotice.value || phase.value !== 'drop') return
  if (textFile.value && textFile.value.text.length > LONG_TEXT_CHARS && !longOk) {
    askLong.value = true
    return
  }
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
          ? newTextJob(textFile.value.name, textFile.value.text, mode.value, textFile.value.type)
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
  pendingDraft.value = null
  keepDraft(true)
  existingTags.value = await listVaultTags(notesRoot(props.config)).catch(() => [])
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
  let doneSteps = job.value.steps.filter((s) => s.status === 'done').length
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
      // 费用记录写不进去不打断处理
      onUsage: (rec) => void appendUsage(rec).catch(() => {}),
      onUpdate: () => {
        const done = job.value?.steps.filter((s) => s.status === 'done').length ?? 0
        if (done > doneSteps) keepDraft()
        doneSteps = done
      },
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
    keepDraft()
  }
}

function cancel() {
  abort?.abort()
}

/** 返回修改：保留放入的内容，丢掉这次的处理结果 */
function backToEdit() {
  job.value = null
  dropDraft()
  phase.value = 'drop'
}

// ---------------- 草稿恢复（F10，设计稿 设计稿/投放页/状态-有草稿.webp） ----------------
const pendingDraft = shallowRef<{ data: DraftData; files: Record<string, Blob> } | null>(null)
const confirmingDrop = ref(false)
const draftLabel = computed(() => {
  if (!pendingDraft.value) return ''
  const r = fromDraft(pendingDraft.value.data, pendingDraft.value.files)
  const state = r.atConfirm ? '已整理完，还没保存' : r.needsFile ? '还没转写完' : '处理到一半'
  return `${r.job.fileName} · ${state}`
})

/** 继续：整理完的回确认页；没整理完的接着处理（已完成的步骤不重做）；音视频没转写完要重新放入原文件 */
async function resumeDraft() {
  const d = pendingDraft.value
  if (!d) return
  pendingDraft.value = null
  const { job: j, needsFile, atConfirm } = fromDraft(d.data, d.files)
  clearContent(true)
  mode.value = j.mode
  source.value = j.source ?? ''
  share.value =
    j.platform || j.author
      ? { url: j.source ?? '', platform: j.platform ?? '', author: j.author ?? '', raw: j.shareText ?? '' }
      : null
  request.value = j.request ?? ''
  if (needsFile) {
    errors.value.push(`上次的「${j.fileName}」还没转写完，请重新放入这个文件。`)
    dropDraft()
    return
  }
  if (j.images) images.value = j.images.map((i) => ({ file: i.file, url: URL.createObjectURL(i.file) }))
  else if (j.type === '文字' || j.type === '文档')
    textFile.value = { name: j.fileName, text: j.transcript ?? '', type: j.type }
  job.value = reactive(j) as Job
  existingTags.value = await listVaultTags(notesRoot(props.config)).catch(() => [])
  if (atConfirm) phase.value = 'confirm'
  else await run()
}
function discardDraft() {
  if (!confirmingDrop.value) {
    confirmingDrop.value = true // 放弃前再确认一次（方案第 12 节“放弃草稿前需要确认”）
    return
  }
  confirmingDrop.value = false
  pendingDraft.value = null
  dropDraft()
}

// ---------------- 关闭窗口（F10，方案第 8 节，设计稿 设计稿/确认页/定稿-关闭确认弹窗.webp） ----------------
const askClose = ref(false)
const hasUnsaved = () => !!job.value && ['processing', 'failed', 'confirm'].includes(phase.value)
let unguard: (() => void) | undefined

// ---------------- 保存后 ----------------
const saved = ref<SavedNote | null>(null)
function onEdited(edits: NoteDraft) {
  if (!job.value) return
  job.value.edits = edits
  keepDraft()
}
function onSaved(note: SavedNote) {
  saved.value = note
  phase.value = 'saved'
  dropDraft()
}
/** 保存成功页的「打开文档」：进软件里的笔记页（F22），不再用 Obsidian 或别的程序 */
const open = () => emit('openNote', saved.value!.path)
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
  // 不在软件里（开发预览）时没有外壳，这两件事都跳过
  loadDraft()
    .then((d) => (pendingDraft.value = d))
    .catch(() => {})
  guardClose(hasUnsaved, () => (askClose.value = true))
    .then((f) => (unguard = f))
    .catch(() => {})
})
onBeforeUnmount(() => {
  unguard?.()
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
    @edited="onEdited"
    @go-settings="emit('goSettings')"
    @config-changed="(c) => emit('configChanged', c)"
    @discard="next"
  />

  <main v-else-if="phase === 'saved' && saved" class="page proc-page">
    <SavedView
      :cost="job?.costUnknown ? undefined : job?.cost"
      :note="saved"
      :location="storeLabel(config)"
      @open="open"
      @next="next"
    />
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
      <div v-if="pendingDraft && !hasContent" class="draft-line">
        <Clock :size="16" aria-hidden="true" />
        <span class="draft-text">有 1 条未保存的草稿：{{ draftLabel }}</span>
        <button
          v-press="confirmingDrop ? 'tactile' : 'surface'"
          class="soft small"
          :class="{ danger: confirmingDrop }"
          @click="discardDraft"
        >
          {{ confirmingDrop ? '确认放弃' : '放弃' }}
        </button>
        <button v-press="'tactile'" class="primary small" @click="resumeDraft">继续</button>
      </div>
      <template v-if="images.length">
        <div class="thumbs">
          <figure v-for="(img, i) in images" :key="img.url" class="thumb">
            <img :src="img.url" :alt="img.file.name" />
            <button v-press="'icon'" class="thumb-x" :aria-label="`移除 ${img.file.name}`" @click="removeImage(i)">
              <X :size="12" />
            </button>
          </figure>
          <button
            v-if="images.length < MAX_IMAGES"
            v-press="'ripple'"
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
          <FileTypeIcon :kind="textFile ? kindOfName(textFile.name) : 'audio'" :size="32" />
        </span>
        <span class="item-text">
          <span class="item-name">{{ textFile?.name ?? file!.name }}</span>
          <span class="item-info">{{ itemInfo }}</span>
        </span>
        <button
          v-press="'icon'"
          class="icon-x item-remove"
          aria-label="移除文件"
          title="移除文件"
          @click="clearContent()"
        >
          <X :size="18" />
        </button>
      </div>

      <button v-else v-press="'ripple'" class="drop" :class="{ dragging }" @click="fileInput?.click()">
        <FilePlus2 class="drop-icon" :size="48" aria-hidden="true" />
        <span class="big">{{ dragging ? '松开即可放入' : '拖入或粘贴内容' }}</span>
        <span class="kinds" aria-label="支持音视频、截图、md / txt、pdf / docx">
          <span v-for="k in SUPPORTED" :key="k.label" class="kind">
            <FileTypeIcon :kind="k.kind" :size="18" />{{ k.label }}
          </span>
        </span>
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".mp4,.mov,.mp3,.m4a,.wav,.md,.txt,.pdf,.docx,image/*"
        hidden
        @change="onPick"
      />
      <p v-for="e in errors" :key="e" class="notice">
        <CircleAlert :size="15" aria-hidden="true" /><span>{{ e }}</span>
        <button v-press="'icon'" class="icon-x" aria-label="关闭提示" @click="errors = errors.filter((x) => x !== e)">
          <X :size="14" />
        </button>
      </p>

      <label class="field">
        <span class="field-label">来源链接<span class="optional"> · 选填</span></span>
        <span class="input link-input">
          <Link2 v-if="!source" :size="16" aria-hidden="true" />
          <input
            v-model="source"
            placeholder="粘贴链接或分享文字"
            spellcheck="false"
            @paste="onSourcePaste"
            @input="onSourceInput"
          />
        </span>
      </label>
      <p v-if="share" class="share">
        <span>{{ [share.platform, share.author && `@${share.author}`].filter(Boolean).join(' · ') }}</span>
        <span class="share-from">已从分享文字识别</span>
        <button v-press class="link" @click="restoreShareText">改回原文</button>
      </p>

      <div class="field">
        <span class="field-label">整理方式</span>
        <div class="modes">
          <button
            v-for="m in MODES"
            :key="m"
            v-press
            class="mode"
            :class="{ on: mode === m }"
            :aria-pressed="mode === m"
            @click="mode = m"
          >
            <component :is="MODE_ICONS[m]" :size="16" aria-hidden="true" />{{ m }}
          </button>
          <span v-if="autoPicked" class="hint">已根据文件类型自动选择</span>
        </div>
      </div>

      <label class="field">
        <span class="field-label">本次要求<span class="optional"> · 选填</span></span>
        <span class="input textarea">
          <textarea
            v-model="request"
            rows="2"
            :maxlength="REQUEST_MAX"
            placeholder="比如：重点写可借鉴的做法 / 只要三句话总结"
          />
          <span class="count">{{ request.length }}/{{ REQUEST_MAX }}</span>
        </span>
      </label>

      <p v-if="lengthNotice" class="notice">
        <CircleAlert :size="15" aria-hidden="true" /><span>{{ lengthNotice }}</span>
      </p>
      <p v-else-if="waitNotice" class="notice info">
        <Clock :size="15" aria-hidden="true" /><span>{{ waitNotice }}</span>
      </p>
      <p v-if="missingService && hasContent" class="notice">
        <CircleAlert :size="15" aria-hidden="true" /><span>还没有配置{{ missingService }}，请先到设置中填写。</span>
        <button v-press class="link" @click="emit('goSettings')">去设置</button>
      </p>

      <div class="actions">
        <button
          v-press="'tactile'"
          class="primary start"
          :disabled="!hasContent || !!missingService || !!lengthNotice"
          @click="start"
        >
          开始处理 <span class="muted-on-primary">Ctrl+Enter</span>
        </button>
      </div>
    </div>
  </main>
  <NoticeDialog
    v-if="askLong"
    title="内容较长"
    cancel-text="取消"
    ok-text="继续整理"
    @cancel="askLong = false"
    @ok="((askLong = false), (longOk = true), start())"
  >
    <p>这份内容有 {{ textFile?.text.length.toLocaleString() }} 字，整理可能需要更久、花费更多。{{ waitNotice }}</p>
  </NoticeDialog>
  <NoticeDialog
    v-if="askClose"
    title="还有 1 条没有保存"
    cancel-text="取消"
    ok-text="关闭软件"
    @cancel="askClose = false"
    @ok="destroyWindow"
  >
    <p>草稿会保留，下次打开时可以继续。</p>
  </NoticeDialog>
</template>

<style scoped>
/* 投放页：一张白卡片，分组只靠留白和灰色小标题；尺寸只用 src/style.css 的令牌 */
.page {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-4);
}
.card {
  padding: var(--sp-5);
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

/* ---- 有草稿：卡片最上面一行，没有底色和边框 ---- */
.draft-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.draft-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.small {
  height: var(--h-xs);
  padding: 0 var(--px-sm);
  font-size: var(--fs-sm);
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
.soft.danger {
  color: var(--err);
}

/* ---- 空白时的投放区：悬停浅靛蓝，拖入时显示细虚线 ---- */
.drop {
  width: 100%;
  height: auto;
  min-height: 136px;
  padding: var(--sp-6) var(--sp-4);
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
  background: var(--accent-soft);
}
.drop.dragging {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
}
.drop:hover:not(:disabled) .drop-icon,
.drop.dragging .drop-icon {
  color: var(--accent);
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
  background: var(--card-muted);
}
.kinds {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.kind {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  padding: 0 var(--sp-3);
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
.item-remove {
  position: relative;
  width: calc(var(--h-md) + var(--sp-2));
  height: calc(var(--h-md) + var(--sp-2));
}
.item-remove::before {
  content: '';
  position: absolute;
  inset: calc((var(--h-md) + var(--sp-2) - var(--file-remove-hover-size)) / 2);
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.item-remove:hover:not(:disabled) {
  background: none;
}
.item-remove:hover:not(:disabled)::before {
  background: var(--hover);
}
.item-remove > svg {
  position: relative;
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
  align-items: flex-start;
  line-height: 1.6;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-sm);
  color: var(--fg);
}
.notice > svg:first-child {
  flex: none;
  margin-top: calc((1.6em - 15px) / 2);
  color: var(--warn);
}
.notice.info > svg:first-child {
  color: var(--muted);
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
  margin-top: var(--sp-4);
}
.field-label {
  display: block;
  margin-bottom: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.optional {
  font-size: var(--fs-xs);
  color: var(--faint);
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
  box-shadow: var(--shadow-card);
}
.modes .hint {
  margin-left: var(--sp-4);
  font-size: var(--fs-xs);
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--sp-4);
}
.muted-on-primary {
  margin-left: var(--sp-3);
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
