<script setup lang="ts">
import { vPress } from '../components/pressFeedback'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import {
  CircleAlert,
  Pencil,
  Folder,
  Video,
  Clock,
  FileText,
  Mic,
  CalendarDays,
  Image as ImageIcon,
  Link2,
  Trash2,
  ExternalLink,
  ChevronLeft,
  User,
  AudioLines,
  ImageOff,
} from '../components/icons'
import { type Config, addDomain, checkDomainName, OTHER_DOMAIN_ID, notesRoot, storeLabel } from '../core/config'
import type { Job } from '../core/pipeline'
import { resolveAttachment } from '../core/library'
import { buildMarkdown, safeFileTitle, today, type NoteDraft, type NoteImage, type NoteMeta } from '../core/note'
import { cropForSave, type Rect } from '../core/image'
import { saveFailure, type SaveFailure } from '../core/saveFailure'
import { matchToSource } from '../core/sourceMatch'
import {
  clearEditRecovery,
  readVideoAttachment,
  openLink,
  openNote,
  saveEditRecovery,
  removeAttachment,
  saveConfig,
  saveNote,
  writeAttachment,
  writeClipboard,
  writeNote,
} from '../shell/tauri'
import type { NoteRecovery } from '../core/noteRecovery'
import { editorExtensions, fixCallouts } from '../editor/extensions'
import { linkedBlockKey } from '../editor/linkedBlock'
import InfoTip from '../components/InfoTip.vue'
import NoteProps from '../components/NoteProps.vue'
import SourcePanel from '../components/SourcePanel.vue'
import OriginalImagePanel from '../components/OriginalImagePanel.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import { Camera, Expand, Pause, Play, Plus, Volume, VolumeMute, X } from '../components/icons'
import CropDialog from '../components/CropDialog.vue'
import NoticeDialog from '../components/NoticeDialog.vue'
import { toast } from '../components/useToast'

/** 打开已有笔记修改（F22）：和确认页是同一个界面，保存时改原来的文件，不是新建 */
export interface EditInfo {
  attachments?: string[]
  /** 打开时的完整文件，保存前用于检查外部修改 */
  originalText: string
  /** 笔记相对存放文件夹的路径 */
  path: string
  /** 文件名（不含 .md） */
  stem: string
  /** 原来的属性：类型、整理方式、来源、收藏日期这些界面上不改的，保存时原样写回 */
  meta: NoteMeta
  /** 正文前面的图片，保存时原样写回 */
  images: NoteImage[]
  /** 读不到的图片数，在图片的位置提示“图片文件不存在” */
  missing: number
  /** 连的是 Obsidian 仓库时才有“在 Obsidian 中打开” */
  canOpen: boolean
}

const props = withDefaults(
  defineProps<{
    config: Config
    job: Job
    videoFile?: File
    existingTags: string[]
    edit?: EditInfo
    active?: boolean
    recovery?: NoteRecovery
  }>(),
  { active: true, edit: undefined, recovery: undefined, videoFile: undefined },
)
/** 保存成功页要用的：笔记相对收藏库的路径、没写进去的图片（比如“第 2 张”），以及左边预览框的文字 */
export interface SavedNote {
  path: string
  failedImages: string[]
  title: string
  summary: string
  text: string
}
/** edited：确认页改到一半的内容，由投放页存进草稿 */
const emit = defineEmits<{
  saved: [SavedNote]
  discard: []
  goSettings: []
  edited: [NoteDraft]
  configChanged: [Config]
  updated: [string]
  back: []
  remove: []
  open: []
  dirty: [boolean]
}>()

const d = props.job.draft!
/** 从草稿恢复时接着上次改到的地方（F10） */
const start = props.job.edits ?? d
const form = reactive({
  title: start.title,
  domainId: start.domainId,
  tags: [...start.tags],
  keywords: [...start.keywords],
  summary: start.summary,
})
const created = props.edit?.meta.created || today()
/** 内容来自语音转写（只有音频、视频）；文字、文档、图片不是 */
const fromSpeech = props.job.type === '音频' || props.job.type === '视频'
const attachmentPicker = ref<HTMLInputElement>()
const savedAttachments = ref(props.edit?.attachments ?? [])
const pendingAttachments = ref<File[]>([])
const attachmentToRemove = ref<{ index: number; pending: boolean } | null>(null)

function pickAttachments(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  pendingAttachments.value.push(...Array.from(input.files ?? []))
  input.value = ''
}

function removeNoteAttachment() {
  const target = attachmentToRemove.value
  if (!target || saving.value) return
  const list = target.pending ? pendingAttachments.value : savedAttachments.value
  list.splice(target.index, 1)
  attachmentToRemove.value = null
}

async function openNoteAttachment(path: string) {
  if (!props.edit) return
  try {
    const rel = resolveAttachment(props.edit.path, path)
    if (!rel.startsWith('附件/')) throw new Error('附件路径不合法')
    await openNote(notesRoot(props.config), rel, false)
  } catch {
    toast('无法打开附件。')
  }
}

const sourceLink = ref(props.edit?.meta.source ?? props.job.source ?? '')
const sourceEdit = ref<string | null>(null)
const sourceInput = ref<HTMLInputElement>()

async function editSourceLink() {
  sourceEdit.value = sourceLink.value
  await nextTick()
  sourceInput.value?.focus({ preventScroll: true })
  sourceInput.value?.setSelectionRange(0, 0)
  if (sourceInput.value) sourceInput.value.scrollLeft = 0
}

function applySourceLink() {
  if (sourceEdit.value === null) return
  sourceLink.value = sourceEdit.value.trim()
  sourceEdit.value = null
}

async function copySourceLink() {
  try {
    await writeClipboard(sourceLink.value)
    toast('来源链接已复制。')
  } catch {
    toast('未能复制来源链接。')
  }
}
async function openSourceLink() {
  try {
    await openLink(sourceLink.value)
  } catch {
    toast('无法打开来源链接。')
  }
}

const transcript = props.job.transcript ?? ''
/** 提取内容：图片显示原图对照；视频只显示口播稿，不出现原图对照 */
const extracting = computed(() => props.job.mode === '提取内容')
const imageCompare = computed(() => extracting.value && (props.job.images?.length ?? 0) > 0)
const textCompare = computed(() => !extracting.value && !!transcript && !imageCompare.value)
const imageTexts = computed(() => props.job.draft?.image_texts ?? [])
const missingImages = computed(() => imageTexts.value.flatMap((text, i) => (text.trim() ? [] : [i + 1])))
const missingImagesText = computed(() => {
  const list = missingImages.value
  if (!list.length) return ''
  return `第 ${list.join('、')} 张没有识别到文字；其他图片的文字仍可编辑和保存。`
})

// ---------------- 图片（F29）----------------
// 图片放在正文前面，按裁剪框显示；悬停时可以调整裁剪或恢复原图
const videoPanel = ref(false)
const videoPlayer = ref<HTMLVideoElement>()
const videoUrl = ref(props.videoFile ? URL.createObjectURL(props.videoFile) : '')
const videoLoadError = ref(false)
const videoFrames = ref<{ file: File; caption: string; width: number; height: number; crop?: Rect | null }[]>([])
const removedFrames = ref<number[]>([])
const askKeepVideo = ref(false)
const keepVideo = ref(false)
const capturing = ref(false)
const zoomFrame = ref('')
const removedDraftPictures = ref<number[]>([])
const frameToDelete = ref<{ saved: boolean; index: number; picture?: boolean } | null>(null)

function askPictureDelete(index: number) {
  const picture = pics[index]
  const added = videoFrames.value.findIndex((frame) => frame.file === picture.file)
  frameToDelete.value =
    added >= 0
      ? { saved: false, index: added }
      : props.edit
        ? { saved: true, index: picture.noteImageIndex ?? index, picture: true }
        : { saved: false, index, picture: true }
}

function confirmFrameDelete() {
  const target = frameToDelete.value
  if (target && !saving.value) {
    if (target.saved) removedFrames.value.push(target.index)
    else if (target.picture) removedDraftPictures.value.push(target.index)
    else videoFrames.value.splice(target.index, 1)
  }
  frameToDelete.value = null
}
const expandedVideo = ref<HTMLDialogElement>()
const videoExpanded = ref(false)
const muted = ref(false)
const volume = ref(1)
function expandVideo() {
  expandedVideo.value?.showModal()
  videoExpanded.value = true
}
function changeVolume(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  volume.value = event.target.valueAsNumber
  if (videoPlayer.value) videoPlayer.value.volume = volume.value
  if (volume.value > 0) muted.value = false
}
const playTime = ref(0)
const playDuration = ref(0)
const videoAspect = ref(16 / 9)

function loadVideoMetadata() {
  const player = videoPlayer.value
  if (!player) return
  playDuration.value = player.duration
  if (player.videoHeight > 0) videoAspect.value = player.videoWidth / player.videoHeight
}
const playing = ref(false)
function playbackTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function seekFrame(caption: string) {
  const parts = caption.match(/^(\d+):(\d{2})$/)
  if (parts && videoPlayer.value) {
    videoPlayer.value.currentTime = Number(parts[1]) * 60 + Number(parts[2])
    playTime.value = videoPlayer.value.currentTime
  }
}
function seekFromSlider(event: Event) {
  if (event.target instanceof HTMLInputElement && videoPlayer.value) {
    videoPlayer.value.currentTime = event.target.valueAsNumber
    playTime.value = videoPlayer.value.currentTime
  }
}
function togglePlayback() {
  const player = videoPlayer.value
  if (!player) return
  if (player.paused) void player.play().catch(() => toast('无法播放视频。'))
  else player.pause()
}
let disposed = false
const videoLoading = new AbortController()

function switchFromVideo(compare: boolean) {
  videoPanel.value = false
  setComparing(compare)
}

function confirmVideoSave() {
  askKeepVideo.value = false
  void save(keepVideo.value)
}

async function showVideo() {
  setComparing(false)
  videoPanel.value = true
  const edit = props.edit
  if (!edit?.meta.video || videoUrl.value || videoLoadError.value) return
  try {
    const path = resolveAttachment(edit.path, edit.meta.video)
    const blob = await readVideoAttachment(notesRoot(props.config), path, videoLoading.signal)
    if (!disposed && !videoUrl.value) videoUrl.value = URL.createObjectURL(blob)
  } catch {
    videoLoadError.value = true
  }
}

async function captureVideoFrame() {
  const video = videoPlayer.value
  if (!video || capturing.value || saving.value) return
  capturing.value = true
  try {
    video.pause()
    const deadline = Date.now() + 3000
    while ((video.seeking || video.readyState < 2) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 40))
    if (disposed || videoPlayer.value !== video) return
    if (video.seeking || video.readyState < 2 || !video.videoWidth) {
      toast('视频还没定位完成，请重试。')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    const seconds = Math.floor(video.currentTime)
    const caption = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    context.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob && !disposed && videoPlayer.value === video) {
      const file = new File([blob], '画面.png', { type: 'image/png' })
      pics.push({ file, noteImageIndex: -1 })
      picUrls.push(URL.createObjectURL(file))
      naturals.value.push({ w: canvas.width, h: canvas.height })
      videoFrames.value.push({
        file,
        caption,
        width: canvas.width,
        height: canvas.height,
      })
      toast(`已截取 ${caption}。`)
    }
  } catch {
    toast('无法截取当前画面，请重试。')
  } finally {
    capturing.value = false
  }
}

const frameUrls = ref<string[]>([])
watch(
  videoFrames,
  (frames) => {
    frameUrls.value.forEach((url) => URL.revokeObjectURL(url))
    frameUrls.value = frames.map((frame) => URL.createObjectURL(frame.file))
  },
  { deep: true },
)
onBeforeUnmount(() => {
  disposed = true
  videoLoading.abort()
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  frameUrls.value.forEach((url) => URL.revokeObjectURL(url))
  savedFrameUrls.forEach((url) => URL.revokeObjectURL(url))
})

const pics = reactive(props.job.images ?? [])
let savedImages = props.edit?.images.map((img) => ({ ...img })) ?? []
let savedCrops = pics.map((p) => (p.crop ? { ...p.crop } : null))
let savedCover = props.edit?.meta.cover ?? ''
let savedFileContent = props.edit?.originalText ?? ''
const picUrls = pics.map((p) => URL.createObjectURL(p.file))
const savedFrameUrls = reactive(
  new Map(
    pics.flatMap((pic, i) => {
      const path = savedImages[pic.noteImageIndex ?? i]?.path
      return path ? [[path, picUrls[i]] as const] : []
    }),
  ),
)
const savedFrames = ref(savedImages)
const naturals = ref(pics.map(() => ({ w: 0, h: 0 })))
function onPicLoad(i: number, e: Event) {
  const el = e.target as HTMLImageElement
  naturals.value[i] = { w: el.naturalWidth, h: el.naturalHeight }
}
/** 用定位把图片裁成框里的那一块：容器按框的比例，图片按“整张 / 框”放大并移位 */
function cropView(i: number) {
  const n = naturals.value[i]
  const c: Rect = pics[i].crop ?? { x: 0, y: 0, w: n.w, h: n.h }
  if (!n.w || !c.w || !c.h) return { box: {}, fig: {}, img: { position: 'static' as const, width: '100%' } }
  return {
    box: { aspectRatio: `${c.w} / ${c.h}` },
    fig: {
      width: pics[i].width
        ? `min(100%, ${Math.max(MIN_PIC_WIDTH, pics[i].width)}px)`
        : `min(100%, var(--pic-max-w), calc(var(--pic-max-h) * ${c.w / c.h}))`,
    },
    img: {
      width: `${(n.w / c.w) * 100}%`,
      height: `${(n.h / c.h) * 100}%`,
      left: `${(-c.x / c.w) * 100}%`,
      top: `${(-c.y / c.h) * 100}%`,
    },
  }
}
// 拖动只改变排版宽度；pointer capture 保证移出图片后仍可结束，不注册全局监听。
const MIN_PIC_WIDTH = 96
let resize:
  | { index: number; pointerId: number; x: number; y: number; ratio: number; width: number; original?: number }
  | undefined
function setPicWidth(i: number, element: HTMLElement, width: number) {
  const max = element.parentElement?.clientWidth ?? 0
  if (!max) return
  pics[i].width = Math.round(Math.min(max, Math.max(Math.min(MIN_PIC_WIDTH, max), width)))
  rememberEdits()
  void nextTick(updateLink)
}
function startResize(i: number, event: PointerEvent) {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLButtonElement)) return
  const button = event.currentTarget
  const figure = button.closest<HTMLElement>('.pic')
  if (!figure) return
  button.focus({ preventScroll: true })
  resize = {
    index: i,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    ratio: (pics[i].crop?.w ?? naturals.value[i].w) / (pics[i].crop?.h ?? naturals.value[i].h) || 1,
    width: figure.getBoundingClientRect().width,
    original: pics[i].width,
  }
  button.setPointerCapture(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (!resize || resize.pointerId !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return
  const figure = event.currentTarget.closest<HTMLElement>('.pic')
  const dx = event.clientX - resize.x
  const dy = (event.clientY - resize.y) * resize.ratio
  if (figure) setPicWidth(resize.index, figure, resize.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy))
}
function endResize(event: PointerEvent) {
  if (!resize || resize.pointerId !== event.pointerId) return
  if (event.type === 'pointercancel') resetPicWidth(resize.index, resize.original)
  resize = undefined
}
function resetPicWidth(i: number, width?: number) {
  pics[i].width = width
  rememberEdits()
  void nextTick(updateLink)
}
function resetPicture(i: number) {
  pics[i].crop = null
  resetPicWidth(i)
}
function resizeKey(i: number, event: KeyboardEvent) {
  if (event.isComposing || !(event.currentTarget instanceof HTMLElement)) return
  const figure = event.currentTarget.closest<HTMLElement>('.pic')
  if (!figure) return
  if (event.key === 'Escape' && resize) {
    event.preventDefault()
    event.stopPropagation()
    resetPicWidth(resize.index, resize.original)
    resize = undefined
    return
  }
  const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key]
  if (!direction) return
  event.preventDefault()
  setPicWidth(
    i,
    figure,
    (pics[i].width ?? figure.getBoundingClientRect().width) + direction * (event.shiftKey ? 50 : 10),
  )
}
const sameRect = (a?: Rect | null, b?: Rect | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const cropNote = computed(() => {
  const p = pics[0]
  if (!p?.autoCrop) return ''
  if (sameRect(p.crop, p.autoCrop)) return '已自动裁去截图状态栏和空白边缘'
  return p.crop ? '已应用手动裁剪' : '已恢复原图'
})
const cropping = ref<number | null>(null)
const pictureMenu = ref<number | null>(null)
function onCropDone(crops: (Rect | null)[]) {
  crops.forEach((c, i) => (pics[i].crop = c))
  cropping.value = null
  rememberEdits()
}

const editor = useEditor({
  extensions: editorExtensions(),
  content: start.body,
  contentType: 'markdown',
  onUpdate: () => {
    bodyTick.value++
    rememberEdits()
  },
})

// ---------------- 打开已有笔记：有没有改动 ----------------
const bodyTick = ref(0)
const snapshotFields = (includePendingFrames = true, attachments = savedAttachments.value) => [
  form.title,
  form.domainId,
  form.tags,
  form.keywords,
  form.summary,
  sourceLink.value,
  attachments,
  includePendingFrames ? pendingAttachments.value.map((file) => file.name) : [],
  pics.map((p) => [p.crop ?? null, p.width ?? null]),
  includePendingFrames ? videoFrames.value.map((f) => [f.caption, f.crop]) : [],
  includePendingFrames ? removedFrames.value : [],
]
const snapshot = () => JSON.stringify(snapshotFields()) + editorBody()
const baseline = ref<string | null>(null)
// 只改属性时不让编辑器的格式规范化或不支持节点改写原文。
let originalBody = start.body
let originalEditorBody: string | undefined
const sourceMode = ref(false)
const sourceBody = ref(start.body)
const editorBody = () =>
  sourceMode.value ? sourceBody.value : editor.value ? fixCallouts(editor.value.getMarkdown()) : ''
function bodyToSave() {
  const current = editorBody()
  return current === originalEditorBody ? originalBody : current
}
function onSourceInput() {
  bodyTick.value++
  rememberEdits()
}
function needsSource(body: string) {
  let source = false
  const parser = editor.value?.markdown?.instance
  parser?.walkTokens(parser.lexer(body), (token) => {
    if (['image', 'html'].includes(token.type)) source = true
  })
  return source
}
// 编辑器读进去再导出的 Markdown 可能和文件里写的有细微差别，所以以刚读好时的为准
watch(
  editor,
  (e) => {
    if (!e || originalEditorBody !== undefined) return
    // 先完成插件的末尾段落/表格结构整理，避免首次移动光标才补节点而误报修改。
    e.view.dispatch(e.state.tr.setMeta('addToHistory', false))
    // 用现有 Markdown 词法器识别未安装对应节点的格式，不自行解析 Markdown。
    sourceMode.value = needsSource(start.body)
    originalEditorBody = editorBody()
    e.setEditable(!sourceMode.value, false)
    if (props.recovery) {
      for (const [index, p] of pics.entries()) {
        const saved = props.recovery.images.find((image) => image.index === (p.noteImageIndex ?? index))
        if (saved) p.crop = saved.savedCrop ? { ...saved.savedCrop } : null
      }
    }
    if (props.edit) baseline.value = snapshot()
    if (props.recovery) {
      const recovery = props.recovery
      const { title, domainId, tags, keywords, summary } = recovery.draft
      Object.assign(form, { title, domainId, tags: [...tags], keywords: [...keywords], summary })
      sourceMode.value = needsSource(recovery.draft.body)
      sourceBody.value = recovery.draft.body
      e.setEditable(!sourceMode.value, false)
      if (!sourceMode.value) e.commands.setContent(recovery.draft.body, { contentType: 'markdown' })
      for (const [index, p] of pics.entries()) {
        const saved = recovery.images.find((image) => image.index === (p.noteImageIndex ?? index))
        if (saved) {
          savedCrops[index] = saved.savedCrop ? { ...saved.savedCrop } : null
          p.crop = saved.crop
          p.width = saved.width
        }
      }
      // 外部修改时仍使用恢复副本原先的基线，保存沿用原有冲突拒绝保护。
      savedFileContent = recovery.originalText
      bodyTick.value++
    }
  },
  { immediate: true },
)
// 正文每改一次 bodyTick 加一，让这里重新比对（编辑器里的内容本身不是响应式的）
const dirty = computed(
  () => !!props.edit && baseline.value !== null && bodyTick.value >= 0 && snapshot() !== baseline.value,
)
watch(dirty, (v) => emit('dirty', v))

const recoveryError = ref('')
let recoveryPath = props.edit?.path ?? ''
let recoveryTimer: number | undefined
let recoveryDiscarded = false
function reportRecoveryError(error: unknown) {
  recoveryError.value = `本地恢复副本未能更新：${String(error)}。请检查磁盘空间或权限。`
}
function persistRecovery(): Promise<void> {
  if (!props.edit || recoveryDiscarded || baseline.value === null) return Promise.resolve()
  const root = notesRoot(props.config)
  const operation = dirty.value
    ? saveEditRecovery({
        version: 1,
        root,
        path: recoveryPath,
        savedAt: Date.now(),
        originalText: savedFileContent,
        draft: { ...d, ...form, tags: [...form.tags], keywords: [...form.keywords], body: bodyToSave() },
        images: pics.map((p, index) => ({
          index: p.noteImageIndex ?? index,
          source:
            props.recovery?.images.find((entry) => entry.index === (p.noteImageIndex ?? index))?.source ??
            props.edit?.images[p.noteImageIndex ?? index]?.path,
          savedCrop: savedCrops[index] ? { ...savedCrops[index] } : null,
          crop: p.crop ? { ...p.crop } : null,
          width: p.width,
        })),
      })
    : clearEditRecovery(root, recoveryPath)
  return operation.then(() => {
    recoveryError.value = ''
  }, reportRecoveryError)
}
watch(
  () => [bodyTick.value, snapshot()],
  () => {
    if (!props.edit || recoveryDiscarded || recoveryTimer !== undefined) return
    // 连续输入也定期写检查点，不因每次按键重置计时而一直推迟。
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = undefined
      void persistRecovery()
    }, 800)
  },
)
async function discardRecovery(): Promise<boolean> {
  window.clearTimeout(recoveryTimer)
  recoveryTimer = undefined
  recoveryDiscarded = true
  try {
    await clearEditRecovery(notesRoot(props.config), recoveryPath)
    return true
  } catch (error) {
    recoveryDiscarded = false
    reportRecoveryError(error)
    return false
  }
}
defineExpose({ discardRecovery })

// 改动停下来 0.8 秒后存进草稿，软件意外关掉也不丢（F10）
let draftTimer: number | undefined
function rememberEdits() {
  if (props.edit) return // 打开已有笔记不存草稿
  clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    if (!editor.value) return
    emit('edited', {
      ...d,
      ...form,
      tags: [...form.tags],
      keywords: [...form.keywords],
      body: bodyToSave(),
    })
  }, 800)
}
watch(form, rememberEdits, { deep: true })

const duration = computed(() => {
  const s = Math.round(props.job.duration ?? 0)
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''
})

// ---------------- 对照原文 ----------------
// 右栏两个标签页：「属性信息」（默认，所有修改在这里做）和「原文对照」。
// 对照原文时，标题下多出一行属性（只看不改），点它回到属性信息。
const comparing = ref(false)
const activeImage = ref<number | null>(null)
function setComparing(on: boolean) {
  if (on === comparing.value) return
  comparing.value = on
  activeImage.value = null
  if (!on) clearLink()
  else if (textCompare.value) refreshCoverage()
}

/** 正文里参与比对的段落：段落、列表项、引用里的段落，按出现顺序 */
function bodyBlocks(): HTMLElement[] {
  const root = paperEl.value?.querySelector('.tiptap')
  if (!root) return []
  return [
    ...root.querySelectorAll<HTMLElement>(':scope > p, :scope > ul > li, :scope > ol > li, :scope > blockquote > p'),
  ]
}

const coverage = ref(matchToSource([], transcript))
function refreshCoverage() {
  coverage.value = matchToSource(
    bodyBlocks().map((el) => el.textContent ?? ''),
    transcript,
  )
}

const activeMatch = ref<{ from: number; to: number } | 'none' | null>(null)

/** 在编辑器里标出点中的段落（用编辑器的装饰，见 linkedBlock.ts）；pos 为 null 时清除 */
function markBlock(pos: number | null) {
  const view = editor.value?.view
  if (view) view.dispatch(view.state.tr.setMeta(linkedBlockKey, pos))
}
const linkedEl = () => paperEl.value?.querySelector<HTMLElement>('.is-linked') ?? null

/** 图片提取：正文段落属于哪张图——往上找最近的“### 第 N 张”，没有就按第一张 */
function imageIndexAtBlock(block: HTMLElement): number {
  if (pics.length <= 1) return 0
  const root = paperEl.value?.querySelector('.tiptap')
  let el: Element | null = block
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.tagName === 'H3') {
      const m = /^第\s*(\d+)\s*张/.exec(el.textContent ?? '')
      if (m) return Number(m[1]) - 1
    }
    el = el.previousElementSibling ?? el.parentElement
  }
  return 0
}

/** 对照时点击正文的一段：原文里对应的句子高亮，并画一条连线（F30）；图片提取时高亮对应的原图 */
function onBodyClick(e: MouseEvent) {
  if (!comparing.value) return
  // 列表项里面还包着一层段落，点到的通常是里面那层，所以先找列表项
  const target = e.target as HTMLElement
  const block = target.closest<HTMLElement>('li') ?? target.closest<HTMLElement>('p')
  if (imageCompare.value) {
    activeImage.value = block ? imageIndexAtBlock(block) : null
    return
  }
  const blocks = bodyBlocks()
  const idx = block ? blocks.indexOf(block) : -1
  if (idx < 0 || !editor.value) {
    clearLink()
    return
  }
  refreshCoverage() // 正文可能刚改过
  // 段落或列表项在编辑器里的起点：元素内部的位置减一
  markBlock(editor.value.view.posAtDOM(blocks[idx], 0) - 1)
  activeMatch.value = coverage.value.matches[idx] ?? 'none'
  void nextTick(() => setTimeout(updateLink, 350)) // 等原文滚动到位
}

function clearLink() {
  markBlock(null)
  activeMatch.value = null
  link.value = null
}

// 连线：从正文段落右边连到原文句子左边；任何一头滚出可视区就不画
const confirmEl = ref<HTMLElement>()
const paperEl = ref<HTMLElement>()
const panel = ref<InstanceType<typeof SourcePanel>>()
const link = ref<string | null>(null)
function updateLink() {
  if (imageCompare.value) {
    link.value = null
    return
  }
  const target = panel.value?.activeRect()
  const view = panel.value?.viewportRect()
  const host = confirmEl.value?.getBoundingClientRect()
  const paper = paperEl.value?.getBoundingClientRect()
  const el = linkedEl()
  if (!el || !target || !view || !host || !paper) {
    link.value = null
    return
  }
  const a = el.getBoundingClientRect()
  const ay = a.top + Math.min(a.height, 30) / 2
  const by = target.top + Math.min(target.height, 30) / 2
  const visible = ay > paper.top && ay < paper.bottom && by > view.top && by < view.bottom
  if (!visible) {
    link.value = null
    return
  }
  const x1 = a.right - host.left + 4
  const y1 = ay - host.top
  const x2 = target.left - host.left - 4
  const y2 = by - host.top
  const mid = (x1 + x2) / 2
  link.value = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

// ---------------- 保存 ----------------
const saving = ref(false)
/** 保存失败：先弹提示框；关掉后按钮上方留一行提醒（设计稿 设计稿/确认页/定稿-保存失败*.webp） */
const saveError = ref<SaveFailure | null>(null)
const failDialog = ref(false)
const titleMissing = computed(() => !form.title.trim())
// ---- 新增领域（US4）：存进设置，再选上它 ----
const newDomain = reactive({ open: false, name: '', error: '' })
const newDomainInput = ref<HTMLInputElement>()
const suggestedDomain = computed(() => {
  const name = d.suggestedDomain
  return !props.edit &&
    form.domainId === OTHER_DOMAIN_ID &&
    name &&
    name.length >= 2 &&
    name.length <= 6 &&
    !checkDomainName(name, props.config.domains)
    ? name
    : undefined
})
async function startNewDomain(name = '') {
  Object.assign(newDomain, { open: true, name, error: '' })
  await nextTick()
  newDomainInput.value?.focus()
}
async function confirmNewDomain() {
  const r = addDomain(props.config, newDomain.name)
  if (typeof r === 'string') return (newDomain.error = r)
  try {
    await saveConfig(r.config)
  } catch (e) {
    return (newDomain.error = `领域保存失败：${String(e)}`)
  }
  emit('configChanged', r.config)
  form.domainId = r.domain.id
  newDomain.open = false
  toast(`已新增领域「${r.domain.name}」。`)
}

const domainName = computed(() => props.config.domains.find((x) => x.id === form.domainId)?.name ?? '其他')

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

async function writeImage(title: string, root: string, picture: { file: File; crop: Rect | null }, index: number) {
  const blob = await cropForSave(picture.file, picture.crop)
  const ext = EXT[blob.type] ?? picture.file.name.split('.').pop() ?? 'png'
  const name = `${created}-${safeFileTitle(title).slice(0, 20)}-${index + 1}.${ext}`
  return writeAttachment(root, created.slice(0, 7), name, blob)
}

/** 图片按裁剪框写进 附件/年-月/（方案第 10.4 节）。写不进去的跳过并记下，笔记照样保存 */
async function writeImages(
  title: string,
  root: string,
  pictures: { file: File; crop: Rect | null; width?: number; caption: string; retainOriginal?: boolean }[],
): Promise<{ images: NoteImage[]; written: string[]; failed: string[] }> {
  const images: NoteImage[] = []
  const written: string[] = []
  const failed: string[] = []
  for (const [i, p] of pictures.entries()) {
    const start = written.length
    try {
      const rel = await writeImage(title, root, p, i)
      written.push(rel)
      let original: string | undefined
      if (p.retainOriginal && p.crop) {
        const source = await writeImage(title, root, { file: p.file, crop: null }, i)
        written.push(source)
        original = `../${source}`
      }
      images.push({
        ...(original && p.crop ? { original, crop: p.crop } : {}),
        path: `../${rel}`,
        caption: p.caption,
        width: p.width,
      })
    } catch {
      await Promise.allSettled(written.splice(start).map((path) => removeAttachment(root, path)))
      failed.push(`第 ${i + 1} 张`)
    }
  }
  return { images, written, failed }
}

let savedTitle = start.title.trim()
/** 打开已有笔记再保存：改原来的文件；领域或文件名变了，外壳会把它挪到新位置（不覆盖别的笔记） */
async function saveEdit(e: EditInfo) {
  if (!editor.value) return
  const title = form.title.trim()
  const domain = domainName.value
  const attachments = [...savedAttachments.value]
  const submittedFields = snapshotFields(false, attachments)
  const submittedEditorBody = editorBody()
  const submittedBody = bodyToSave()
  const root = notesRoot(props.config)
  const submitted: NoteDraft = {
    title,
    domainId: form.domainId,
    tags: [...form.tags],
    keywords: [...form.keywords],
    summary: form.summary.trim(),
    body: submittedBody,
    image_captions: [],
  }
  const images = savedImages.map((img) => ({ ...img }))
  const submittedCrops = pics.map((p) => (p.crop ? { ...p.crop } : null))
  const pictures = pics.map((p, i) => ({
    file: p.file,
    crop: submittedCrops[i],
    width: p.width,
    index: p.noteImageIndex ?? i,
    changed: JSON.stringify(submittedCrops[i]) !== JSON.stringify(savedCrops[i]),
  }))
  const meta = { ...e.meta, domain, cover: savedCover, source: sourceLink.value }
  const written: string[] = []
  try {
    for (const p of pictures) {
      if (removedFrames.value.includes(p.index) || !images[p.index]) continue
      images[p.index] = { ...images[p.index], width: p.width }
      if (!p.changed) continue
      const previous = images[p.index]
      let path = !p.crop ? previous.original : undefined
      if (!path) {
        const rel = await writeImage(title, root, p, p.index)
        written.push(rel)
        path = `../${rel}`
      }
      const original = previous.original ?? (imageCompare.value && p.crop ? previous.path : undefined)
      images[p.index] = {
        ...previous,
        path,
        original: p.crop ? original : undefined,
        crop: original && p.crop ? p.crop : undefined,
      }
      if (props.job.type === '视频') savedFrameUrls.set(path, picUrls[pictures.indexOf(p)])
      if (meta.cover === previous.path) meta.cover = path
    }
    for (const index of [...removedFrames.value].sort((a, b) => b - a)) {
      if (meta.cover === images[index]?.path) meta.cover = ''
      images.splice(index, 1)
    }
    if (!meta.cover) meta.cover = images[0]?.path ?? ''
    if (props.job.type === '视频') {
      if (videoFrames.value.length) await appendVideoFrames(root, title, images, written)
      meta.cover = images[0]?.path ?? ''
    }
    const pending = [...pendingAttachments.value]
    for (const file of pending) {
      const rel = await writeAttachment(root, today().slice(0, 7), file.name, file)
      written.push(rel)
      attachments.push(`../${rel}`)
    }
    const md = buildMarkdown(submitted, meta, images, attachments)
    // 文件名跟着标题走；标题没改过就不动文件名（笔记可能重名时加过日期，或在 Obsidian 里改过名）
    const stem = title === savedTitle ? e.stem : safeFileTitle(title)
    const rel = await saveNote(root, e.path, domain, stem, md, savedFileContent)
    savedFileContent = md
    const previousRecoveryPath = recoveryPath
    recoveryPath = rel
    void clearEditRecovery(root, previousRecoveryPath).catch(reportRecoveryError)
    if (props.job.type === '视频') {
      const added = images.slice(images.length - videoFrames.value.length)
      for (const [i, frame] of videoFrames.value.entries())
        savedFrameUrls.set(added[i].path, URL.createObjectURL(frame.file))
      const paths = new Set(images.map((image) => image.path))
      for (const [path, url] of savedFrameUrls) {
        if (!paths.has(path)) {
          if (!picUrls.includes(url)) URL.revokeObjectURL(url)
          savedFrameUrls.delete(path)
        }
      }
    }
    {
      const removed = new Set(removedFrames.value)
      for (const [i, picture] of pics.entries()) {
        const oldIndex = picture.noteImageIndex ?? i
        if (oldIndex === -1) {
          const addedIndex = videoFrames.value.findIndex((frame) => frame.file === picture.file)
          picture.noteImageIndex = addedIndex < 0 ? -2 : images.length - videoFrames.value.length + addedIndex
        } else if (oldIndex >= 0) {
          picture.noteImageIndex = removed.has(oldIndex)
            ? -2
            : oldIndex - [...removed].filter((index) => index < oldIndex).length
        }
      }
      savedFrames.value = images
      videoFrames.value = []
      removedFrames.value = []
    }
    savedImages = images
    savedCrops = submittedCrops
    savedCover = meta.cover
    savedTitle = title
    savedAttachments.value = attachments
    pendingAttachments.value = []
    baseline.value = JSON.stringify(submittedFields) + submittedEditorBody
    originalBody = submittedBody
    originalEditorBody = submittedEditorBody
    // 点完保存告诉用户结果：改了领域就说移到了哪里，改了文件名就说新名字
    toast(
      rel.split('/')[0] !== e.path.split('/')[0]
        ? `已保存，并移至“${domain}”。`
        : stem !== e.stem
          ? `已保存，文件名改为“${stem}”。`
          : '已保存。',
    )
    emit('updated', rel)
  } catch (err) {
    // 只清理本次新建的副本，旧附件可能还被其他笔记引用。
    for (const rel of written) await removeAttachment(root, rel).catch(() => {})
    saveError.value = saveFailure(String(err))
    failDialog.value = true
  }
}

async function appendVideoFrames(root: string, title: string, images: NoteImage[], written: string[]) {
  for (const frame of videoFrames.value) {
    const picture = pics.find((pic) => pic.file === frame.file)
    const rel = await writeImage(title, root, { file: frame.file, crop: picture?.crop ?? null }, images.length)
    written.push(rel)
    images.push({ path: `../${rel}`, caption: frame.caption, width: picture?.width })
  }
}

async function save(videoChoice?: boolean) {
  if (saving.value || capturing.value || titleMissing.value || !editor.value) return
  if (!props.edit && props.videoFile && videoChoice === undefined) {
    keepVideo.value = false
    askKeepVideo.value = true
    return
  }
  if (props.edit && !dirty.value) return
  saving.value = true
  saveError.value = null
  if (props.edit) {
    await saveEdit(props.edit)
    saving.value = false
    return
  }
  const title = form.title.trim()
  const root = notesRoot(props.config)
  const domain = domainName.value
  const text = sourceMode.value ? sourceBody.value : editor.value.getText({ blockSeparator: '\n' })
  const submitted: NoteDraft = {
    ...d,
    ...form,
    title,
    summary: form.summary.trim(),
    tags: [...form.tags],
    keywords: [...form.keywords],
    body: bodyToSave(),
    image_captions: [...d.image_captions],
  }
  const pictures = pics.flatMap((p, i) =>
    p.noteImageIndex === -1 || removedDraftPictures.value.includes(i)
      ? []
      : [
          {
            file: p.file,
            crop: p.crop ? { ...p.crop } : null,
            width: p.width,
            caption: d.image_captions[i] ?? '',
            retainOriginal: !!p.region || imageCompare.value,
          },
        ],
  )
  const { images, written, failed } = await writeImages(title, root, pictures)
  try {
    if (videoFrames.value.length) await appendVideoFrames(root, title, images, written)
    let transcriptPath = ''
    if (textCompare.value) {
      const rel = await writeAttachment(
        root,
        created.slice(0, 7),
        `${created}-${safeFileTitle(title).slice(0, 20)}-原文.txt`,
        new Blob([transcript], { type: 'text/plain' }),
      )
      written.push(rel)
      transcriptPath = `../${rel}`
    }
    let video = ''
    if (videoChoice && props.videoFile) {
      const ext = props.videoFile.name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4'
      const rel = await writeAttachment(
        root,
        created.slice(0, 7),
        `${created}-${safeFileTitle(title).slice(0, 20)}-原视频.${ext}`,
        props.videoFile,
      )
      written.push(rel)
      video = `../${rel}`
    }
    const md = buildMarkdown(
      submitted,
      {
        domain,
        type: props.job.type,
        mode: props.job.mode,
        source: props.job.source ?? '',
        platform: props.job.platform ?? '',
        author: props.job.author ?? '',
        created,
        collectedAt: new Date().toISOString(),
        cover: images[0]?.path ?? '',
        video,
        transcript: transcriptPath,
      },
      images,
    )
    const rel = await writeNote(root, domain, safeFileTitle(title), created, md)
    emit('saved', {
      path: rel,
      failedImages: failed,
      title,
      summary: submitted.summary,
      text,
    })
  } catch (e) {
    // 保存失败时编辑中的内容保留（方案第 7 节）；刚写进去的图片删掉，不留没人引用的文件
    for (const rel of written) await removeAttachment(root, rel).catch(() => {})
    saveError.value = saveFailure(String(e))
    failDialog.value = true
  } finally {
    saving.value = false
  }
}

const confirmingDiscard = ref(false)

// Esc 优先收起局部状态，笔记编辑模式再复用返回入口。
function onKey(e: KeyboardEvent) {
  if (!props.active || videoExpanded.value) return
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    if (askKeepVideo.value || zoomFrame.value || videoExpanded.value) return
    e.preventDefault()
    save()
  } else if (e.key === 'Escape') {
    if (e.defaultPrevented || e.isComposing || e.repeat || failDialog.value) return
    e.preventDefault()
    if (comparing.value) setComparing(false)
    else if (confirmingDiscard.value) confirmingDiscard.value = false
    else if (props.edit) emit('back')
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', updateLink)
})
onBeforeUnmount(() => {
  window.clearTimeout(recoveryTimer)
  void persistRecovery()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', updateLink)
  clearTimeout(draftTimer)
  editor.value?.destroy()
  picUrls.forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <main ref="confirmEl" class="confirm" :class="{ comparing }" :inert="saving && !edit" :aria-busy="saving">
    <article ref="paperEl" class="paper" @scroll="updateLink">
      <div class="paper-inner">
        <button v-if="edit" v-press class="back" @click="emit('back')">
          <ChevronLeft :size="18" aria-hidden="true" />收藏库
        </button>
        <label class="editable title-line" style="view-transition-name: note-title">
          <textarea
            v-model="form.title"
            class="title"
            rows="1"
            maxlength="30"
            aria-label="标题"
            placeholder="标题"
            spellcheck="false"
            @keydown.enter.prevent
          />
          <Pencil class="edit-hint" :size="20" duotone aria-hidden="true" />
        </label>
        <p v-if="titleMissing" class="field-error">请填写标题。</p>

        <label v-if="!extracting" class="editable summary" style="view-transition-name: note-summary">
          <textarea v-model="form.summary" rows="1" aria-label="这条讲什么" placeholder="用一句话概括内容" />
          <Pencil class="edit-hint" :size="16" duotone aria-hidden="true" />
        </label>

        <!-- 对照原文时才出现：右栏属性的只读摘要，点一下回到属性信息去修改 -->
        <button
          v-if="comparing"
          v-press
          class="meta-row"
          style="view-transition-name: meta-row"
          title="在右侧属性栏修改"
          @click="setComparing(false)"
        >
          <span class="meta"><Folder :size="14" aria-hidden="true" />{{ domainName }}</span>
          <span v-for="t in form.tags" :key="t" class="meta-chip">{{ t }}</span>
          <span class="meta-sep" aria-hidden="true" />
          <span class="meta meta-source"
            ><Video :size="14" aria-hidden="true" /><span>{{
              [job.fileName, duration, fromSpeech && '语音转写', created].filter(Boolean).join(' · ')
            }}</span></span
          >
        </button>

        <div v-if="pics.length" class="pics">
          <figure
            v-for="(p, i) in pics"
            v-show="
              !removedDraftPictures.includes(i) &&
              (job.type !== '视频'
                ? !edit || ((p.noteImageIndex ?? i) >= 0 && !removedFrames.includes(p.noteImageIndex ?? i))
                : p.noteImageIndex === -1
                  ? videoFrames.some((frame) => frame.file === p.file)
                  : !removedFrames.includes(p.noteImageIndex ?? i) && !!savedFrames[p.noteImageIndex ?? i])
            "
            :key="picUrls[i]"
            class="pic"
            :class="{ 'pic-menu-open': pictureMenu === i }"
            :style="cropView(i).fig"
          >
            <button
              type="button"
              class="pic-crop"
              aria-label="查看大图"
              :style="cropView(i).box"
              @click="zoomFrame = picUrls[i]"
            >
              <img
                :src="picUrls[i]"
                :alt="edit ? (edit.images[p.noteImageIndex ?? i]?.caption ?? '') : (d.image_captions[i] ?? '')"
                :style="cropView(i).img"
                @load="onPicLoad(i, $event)"
              />
            </button>
            <button
              class="pic-resize"
              aria-label="调整图片大小"
              title="拖动调整大小；方向键微调，Shift 加速"
              @pointerdown.stop.prevent="startResize(i, $event)"
              @pointermove="moveResize"
              @pointerup="endResize"
              @pointercancel="endResize"
              @lostpointercapture="endResize"
              @keydown="resizeKey(i, $event)"
            >
              <span aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="frame-remove"
              aria-label="删除图片"
              title="删除图片"
              :disabled="saving"
              @click="askPictureDelete(i)"
            >
              <X :size="12" aria-hidden="true" data-ai-no-spin />
            </button>
            <button
              v-press="'icon'"
              type="button"
              class="pic-menu"
              aria-label="图片操作"
              :aria-expanded="pictureMenu === i"
              @click.stop="pictureMenu = pictureMenu === i ? null : i"
              @keydown.esc.stop="pictureMenu = null"
            >
              ⋯
            </button>
            <div
              class="pic-tools"
              :class="{ 'menu-open': pictureMenu === i }"
              @click="pictureMenu = null"
              @keydown.esc.stop="pictureMenu = null"
            >
              <button v-press aria-label="调整裁剪" title="调整裁剪" @click="cropping = i">调整裁剪</button>
              <button
                v-if="p.crop || p.width !== undefined"
                v-press
                :title="p.crop ? (p.width !== undefined ? '恢复原图和默认尺寸' : '恢复原图') : '恢复默认尺寸'"
                @click="resetPicture(i)"
              >
                恢复
              </button>
            </div>
          </figure>
          <p v-if="cropNote && !edit" class="pic-note">{{ cropNote }}</p>
        </div>
        <p v-if="missingImagesText" class="body-notice" role="status">{{ missingImagesText }}</p>
        <div v-if="edit && edit.missing" class="pics">
          <div v-for="n in edit.missing" :key="n" class="pic-missing">
            <ImageOff :size="22" aria-hidden="true" />图片文件不存在
          </div>
        </div>

        <p v-if="recoveryError" class="body-notice" role="alert">{{ recoveryError }}</p>
        <div class="toolbar-row">
          <EditorToolbar v-if="editor && !sourceMode" :editor="editor" />
        </div>

        <p v-if="sourceMode" class="body-notice">正文含内嵌图片或 HTML，已使用 Markdown 源码编辑，可直接修改并保存。</p>
        <div class="body-wrap" style="view-transition-name: note-body">
          <textarea
            v-if="sourceMode"
            v-model="sourceBody"
            class="body-raw"
            aria-label="Markdown 正文源码"
            spellcheck="false"
            @input="onSourceInput"
          />
          <EditorContent v-else :editor="editor" class="body" @click="onBodyClick" />
        </div>
      </div>
    </article>

    <aside class="side">
      <div class="tabs" role="tablist" aria-label="右栏">
        <!-- 提取内容的图片用完整原图和选区对照；普通图片没有对照页，只有属性信息 -->
        <button
          v-if="imageCompare"
          v-press
          role="tab"
          class="tab"
          :aria-selected="comparing"
          @click="switchFromVideo(true)"
        >
          原图对照
        </button>
        <button
          v-else-if="textCompare"
          role="tab"
          class="tab"
          :aria-selected="comparing"
          @click="switchFromVideo(true)"
        >
          原文对照
        </button>
        <button
          v-press
          role="tab"
          class="tab"
          :aria-selected="!comparing && !videoPanel"
          @click="switchFromVideo(false)"
        >
          属性信息
        </button>
        <button
          v-if="job.type === '视频' && (videoFile || edit?.meta.video || savedImages.length)"
          role="tab"
          class="tab"
          :aria-selected="videoPanel"
          @click="showVideo"
        >
          视频画面
        </button>
        <span class="tab-indicator" aria-hidden="true"></span>
      </div>

      <div class="tab-panels">
        <Transition name="sidebar-tab">
          <div v-if="videoPanel" class="side-main props-area video-panel" :inert="!videoPanel">
            <dialog
              id="expanded-note-video"
              ref="expandedVideo"
              class="expanded-video"
              aria-label="视频画面"
              @close="videoExpanded = false"
            >
              <header class="expanded-video-header">
                <strong>视频画面</strong>
                <button class="link" type="button" aria-label="关闭放大视频" @click="expandedVideo?.close()">×</button>
              </header>
            </dialog>
            <Teleport defer to="#expanded-note-video" :disabled="!videoExpanded">
              <div v-if="videoUrl" class="video-unit" :style="{ '--video-aspect': videoAspect }">
                <video
                  ref="videoPlayer"
                  :src="videoUrl"
                  :muted="muted"
                  :volume.prop="volume"
                  preload="metadata"
                  class="video-player"
                  @loadedmetadata="loadVideoMetadata"
                  @timeupdate="playTime = videoPlayer?.currentTime ?? 0"
                  @play="playing = true"
                  @pause="playing = false"
                  @ended="playing = false"
                />
                <div class="video-controls">
                  <button
                    v-press="'icon'"
                    type="button"
                    class="video-icon"
                    :aria-label="playing ? '暂停' : '播放'"
                    :title="playing ? '暂停' : '播放'"
                    @click="togglePlayback"
                  >
                    <component :is="playing ? Pause : Play" :size="16" />
                  </button>
                  <input
                    class="video-progress"
                    aria-label="视频进度"
                    type="range"
                    min="0"
                    :max="playDuration"
                    step="0.1"
                    :value="playTime"
                    @input="seekFromSlider"
                  />
                  <span class="video-clock">{{ playbackTime(playTime) }} / {{ playbackTime(playDuration) }}</span>
                  <div class="video-sound">
                    <button
                      v-press="'icon'"
                      type="button"
                      class="video-icon"
                      :aria-label="muted ? '取消静音' : '静音'"
                      :title="muted ? '取消静音' : '静音'"
                      @click="muted = !muted"
                    >
                      <component :is="muted ? VolumeMute : Volume" :size="16" />
                    </button>
                    <div class="video-volume-popup">
                      <input
                        class="video-volume"
                        aria-label="音量"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        :value="volume"
                        @input="changeVolume"
                      />
                    </div>
                  </div>
                  <button
                    v-if="!videoExpanded"
                    type="button"
                    class="video-icon"
                    title="放大视频"
                    aria-label="放大视频"
                    @click="expandVideo"
                  >
                    <Expand :size="16" />
                  </button>
                  <button
                    v-if="!videoExpanded"
                    v-press="'icon'"
                    type="button"
                    class="video-icon video-capture-compact"
                    aria-label="截取当前画面"
                    title="截取当前画面"
                    :disabled="capturing || saving"
                    @click="captureVideoFrame"
                  >
                    <Camera :size="16" aria-hidden="true" />
                  </button>
                </div>
                <div v-if="videoExpanded" class="video-capture">
                  <button
                    v-press
                    class="btn btn-secondary video-capture-button"
                    :disabled="capturing || saving"
                    @click="captureVideoFrame"
                  >
                    <Camera :size="16" aria-hidden="true" />
                    截取当前画面
                  </button>
                </div>
              </div>
            </Teleport>
            <p v-if="!videoUrl" class="video-status">
              {{
                videoLoadError
                  ? '无法读取原视频。'
                  : edit?.meta.video
                    ? '正在读取原视频。'
                    : '未保留原视频，只可查看已截取的画面。'
              }}
            </p>
            <div class="video-heading-row">
              <h3 class="video-heading">
                已截取画面
                <span class="frame-count"
                  ><span class="compact-frame-separator" aria-hidden="true">· </span
                  >{{ savedFrames.length - removedFrames.length + videoFrames.length }} 张</span
                >
              </h3>
              <button
                v-if="videoUrl && !videoExpanded"
                v-press
                class="btn btn-secondary video-capture-button"
                :disabled="capturing || saving"
                @click="captureVideoFrame"
              >
                <Camera :size="16" aria-hidden="true" />
                截取当前画面
              </button>
            </div>
            <div class="video-frames">
              <template v-for="(frame, i) in savedFrames" :key="frame.path">
                <div v-if="!removedFrames.includes(i)" class="video-frame">
                  <button
                    type="button"
                    class="video-thumb"
                    :aria-label="'放大 ' + frame.caption"
                    @click="zoomFrame = savedFrameUrls.get(frame.path) ?? ''"
                  >
                    <img
                      v-if="savedFrameUrls.get(frame.path)"
                      :src="savedFrameUrls.get(frame.path)"
                      :alt="frame.caption"
                    />
                  </button>
                  <button
                    v-if="videoUrl"
                    type="button"
                    class="frame-time"
                    :aria-label="'跳到 ' + frame.caption"
                    @click="seekFrame(frame.caption)"
                  >
                    {{ frame.caption }}
                  </button>
                  <span v-else class="frame-time">{{ frame.caption }}</span>
                  <button
                    v-press
                    type="button"
                    class="frame-remove"
                    :disabled="saving"
                    aria-label="移除截图"
                    title="移除截图"
                    @click="frameToDelete = { saved: true, index: i }"
                  >
                    <X :size="12" aria-hidden="true" data-ai-no-spin />
                  </button>
                </div>
              </template>
              <div v-for="(frame, i) in videoFrames" :key="frameUrls[i]" class="video-frame">
                <button
                  type="button"
                  class="video-thumb"
                  :aria-label="'放大 ' + frame.caption"
                  @click="zoomFrame = frameUrls[i] ?? ''"
                >
                  <img v-if="frameUrls[i]" :src="frameUrls[i]" :alt="frame.caption" />
                </button>
                <button
                  v-if="videoUrl"
                  type="button"
                  class="frame-time"
                  :aria-label="'跳到 ' + frame.caption"
                  @click="seekFrame(frame.caption)"
                >
                  {{ frame.caption }}
                </button>
                <span v-else class="frame-time">{{ frame.caption }}</span>
                <button
                  v-press
                  type="button"
                  class="frame-remove"
                  :disabled="saving"
                  aria-label="移除截图"
                  title="移除截图"
                  @click="frameToDelete = { saved: false, index: i }"
                >
                  <X :size="12" aria-hidden="true" data-ai-no-spin />
                </button>
              </div>
            </div>
          </div>
        </Transition>
        <Transition name="sidebar-tab">
          <div v-show="!videoPanel && !comparing" :inert="videoPanel || comparing" class="side-main props-area">
            <!-- 文件名就是标题：两边改的是同一个东西（文件名里不允许的字符保存时换成“-”） -->
            <label class="file-field">
              <h3>文件名</h3>
              <span class="name-input">
                <input v-model="form.title" spellcheck="false" aria-label="文件名" />
                <span class="ext">.md</span>
              </span>
            </label>

            <NoteProps
              v-model:domain-id="form.domainId"
              v-model:tags="form.tags"
              v-model:keywords="form.keywords"
              :domains="config.domains"
              :existing-tags="existingTags"
              :domain-fallback="job.domainFallback"
              :suggested-domain="suggestedDomain"
              @new-domain="startNewDomain"
            />

            <div class="source">
              <h3>来源信息</h3>
              <dl class="facts">
                <div v-if="pics.length" class="fact">
                  <dt><ImageIcon :size="16" />图片</dt>
                  <dd>{{ pics.length }} 张</dd>
                </div>
                <div v-else-if="!edit" class="fact">
                  <dt>
                    <AudioLines v-if="job.type === '音频'" :size="16" /><Video v-else :size="16" />{{ job.type }}文件
                  </dt>
                  <dd class="file">{{ job.fileName }}</dd>
                </div>
                <div v-if="edit && edit.meta.platform" class="fact">
                  <dt><Video :size="16" />平台</dt>
                  <dd>{{ edit.meta.platform }}</dd>
                </div>
                <div v-if="edit && edit.meta.author" class="fact">
                  <dt><User :size="16" />作者</dt>
                  <dd class="file">{{ edit.meta.author }}</dd>
                </div>
                <div v-if="duration" class="fact">
                  <dt><Clock :size="16" />时长</dt>
                  <dd>{{ duration }}</dd>
                </div>
                <div class="fact">
                  <dt><FileText :size="16" />整理方式</dt>
                  <dd>{{ job.mode }}</dd>
                </div>
                <div v-if="fromSpeech && !edit" class="fact">
                  <dt><Mic :size="16" />内容来自</dt>
                  <dd>语音转写</dd>
                </div>
                <div v-if="sourceLink || edit" class="fact" :class="{ 'editing-source': sourceEdit !== null }">
                  <dt><Link2 :size="16" />来源链接</dt>
                  <dd class="file link-text">
                    <template v-if="sourceEdit !== null">
                      <input
                        ref="sourceInput"
                        v-model="sourceEdit"
                        type="text"
                        aria-label="来源链接"
                        @keydown.enter.stop.prevent="applySourceLink"
                        @keydown.esc.stop.prevent="sourceEdit = null"
                      />
                      <button v-press type="button" class="link" @mousedown.prevent @click="applySourceLink">
                        确定
                      </button>
                    </template>
                    <template v-else>
                      <a v-if="/^https?:\/\//i.test(sourceLink)" :href="sourceLink" @click.prevent="openSourceLink">
                        {{ sourceLink }}
                      </a>
                      <span v-else-if="sourceLink">{{ sourceLink }}</span>
                      <button v-if="edit && sourceLink" v-press type="button" class="link" @click="copySourceLink">
                        复制
                      </button>
                      <button v-if="edit" v-press type="button" class="link" @click="editSourceLink">
                        {{ sourceLink ? '编辑' : '添加来源链接' }}
                      </button>
                    </template>
                  </dd>
                </div>
                <div class="fact">
                  <dt><CalendarDays :size="16" />收藏日期</dt>
                  <dd>{{ created }}</dd>
                </div>
              </dl>
              <template v-if="edit">
                <div class="attachment-heading">
                  <h3>附件 <InfoTip text="可添加相关文件。保存修改后，附件会复制到收藏库。" /></h3>
                  <button
                    v-press="'icon'"
                    type="button"
                    class="link attachment-add"
                    :disabled="saving"
                    @click="attachmentPicker?.click()"
                  >
                    <Plus :size="14" aria-hidden="true" /><span>添加附件</span>
                  </button>
                  <input ref="attachmentPicker" type="file" multiple hidden @change="pickAttachments" />
                </div>
                <ul v-if="savedAttachments.length || pendingAttachments.length" class="facts note-attachments">
                  <li v-for="(path, i) in savedAttachments" :key="path">
                    <FileText :size="16" aria-hidden="true" />
                    <button
                      class="attachment-name attachment-open"
                      :title="path.split('/').pop()"
                      @click="openNoteAttachment(path)"
                    >
                      {{ path.split('/').pop() }}
                    </button>
                    <button
                      v-press
                      class="link"
                      :disabled="saving"
                      @click="attachmentToRemove = { index: i, pending: false }"
                    >
                      移除
                    </button>
                  </li>
                  <li v-for="(file, i) in pendingAttachments" :key="i">
                    <FileText :size="16" aria-hidden="true" />
                    <span class="attachment-name" :title="file.name">{{ file.name }}</span>
                    <span class="attachment-status">待保存</span>
                    <button
                      v-press
                      class="link"
                      :disabled="saving"
                      @click="attachmentToRemove = { index: i, pending: true }"
                    >
                      移除
                    </button>
                  </li>
                </ul>
              </template>
            </div>
            <button v-if="edit?.canOpen" v-press class="btn btn-secondary open-obsidian" @click="emit('open')">
              <ExternalLink :size="14" aria-hidden="true" />在 Obsidian 中打开
            </button>
          </div>
        </Transition>
        <Transition name="sidebar-tab">
          <OriginalImagePanel
            v-if="imageCompare"
            v-show="comparing && !videoPanel"
            :inert="!comparing || videoPanel"
            class="side-main"
            :images="
              pics.map((p, i) => ({
                url: picUrls[i],
                name: p.file.name,
                region: p.region ?? null,
                text: imageTexts[i] ?? '',
              }))
            "
            :active="activeImage"
            :show-text="!edit"
            @preview="zoomFrame = $event"
          />
          <SourcePanel
            v-else-if="textCompare"
            v-show="comparing && !videoPanel"
            ref="panel"
            :inert="!comparing || videoPanel"
            class="side-main"
            :sentences="coverage.sentences"
            :unused="coverage.unused"
            :active="activeMatch"
            @scroll="updateLink"
          />
        </Transition>
      </div>

      <footer class="actions">
        <p v-if="saveError && !failDialog" class="save-fail">
          <CircleAlert :size="14" aria-hidden="true" />
          <span><b>保存失败：</b>{{ saveError.reason }}</span>
          <template v-if="saveError.toSettings">
            ·<button v-press class="link" @click="emit('goSettings')">去设置</button>
          </template>
        </p>
        <!-- 保存前就知道会存到哪：跟着领域变 -->
        <p v-else-if="!confirmingDiscard" class="save-to" :title="`${storeLabel(config)} / ${domainName}`">
          <Folder :size="14" aria-hidden="true" />
          <span class="save-location">存到：{{ storeLabel(config) }}</span>
          <span class="save-domain">/ {{ domainName }}</span>
        </p>
        <div v-if="edit" class="action-row">
          <button v-press="'tactile'" class="btn btn-secondary btn-delete" @click="emit('remove')">
            <Trash2 :size="16" aria-hidden="true" />删除
          </button>
          <button
            v-press="'tactile'"
            class="btn btn-primary"
            :disabled="saving || titleMissing || !dirty"
            @click="save()"
          >
            {{ saving ? '保存中…' : saveError ? '重新保存' : '保存修改' }}<span class="kbd">Ctrl+S</span>
          </button>
        </div>
        <template v-else-if="confirmingDiscard">
          <p class="discard-ask">放弃本次整理结果并返回？未保存的内容将丢失。</p>
          <div class="action-row">
            <button v-press class="btn btn-secondary" @click="confirmingDiscard = false">继续编辑</button>
            <button v-press="'tactile'" class="btn btn-danger" @click="emit('discard')">放弃并返回</button>
          </div>
        </template>
        <div v-else class="action-row">
          <button v-press class="btn btn-secondary" @click="confirmingDiscard = true">放弃</button>
          <button v-press="'tactile'" class="btn btn-primary" :disabled="saving || titleMissing" @click="save()">
            {{ saving ? '保存中…' : saveError ? '重新保存' : '保存' }}<span class="kbd">Ctrl+S</span>
          </button>
        </div>
      </footer>
    </aside>

    <NoticeDialog
      v-if="frameToDelete"
      :title="frameToDelete.picture ? '删除图片' : '删除截图'"
      cancel-text="取消"
      ok-text="删除"
      danger
      @cancel="frameToDelete = null"
      @ok="confirmFrameDelete"
    >
      <p>这张{{ frameToDelete.picture ? '图片' : '截图' }}将从当前笔记中移除。确定删除吗？</p>
    </NoticeDialog>
    <NoticeDialog
      v-if="attachmentToRemove"
      title="移除附件"
      cancel-text="取消"
      ok-text="移除"
      danger
      @cancel="attachmentToRemove = null"
      @ok="removeNoteAttachment"
    >
      <p>确定从这篇笔记移除附件吗？</p>
    </NoticeDialog>
    <NoticeDialog v-if="zoomFrame" title="查看图片" cancel-text="关闭" @cancel="zoomFrame = ''">
      <img :src="zoomFrame" alt="查看图片" class="image-preview" />
    </NoticeDialog>
    <NoticeDialog
      v-if="askKeepVideo && videoFile"
      title="保存视频笔记"
      cancel-text="取消"
      ok-text="保存"
      @cancel="askKeepVideo = false"
      @ok="confirmVideoSave"
    >
      <p>已截取的画面会随笔记保存。保留原视频后，重开笔记可继续截取。</p>
      <label class="keep-video-option">
        <input v-model="keepVideo" type="checkbox" />
        <span>保留原视频</span>
        <span class="video-size">（{{ (videoFile.size / 1024 / 1024).toFixed(1) }} MB）</span>
      </label>
    </NoticeDialog>
    <NoticeDialog
      v-if="failDialog && saveError"
      title="保存失败"
      tone="error"
      cancel-text="继续编辑"
      ok-text="重新保存"
      @cancel="failDialog = false"
      @ok="save()"
    >
      <p>{{ saveError.reason }}</p>
      <p v-if="saveError.toSettings">
        请到<button v-press class="link" @click="emit('goSettings')">设置</button
        >{{ saveError.next.replace(/^请到设置/, '') }}
      </p>
      <p v-else>{{ saveError.next }}</p>
    </NoticeDialog>

    <NoticeDialog
      v-if="newDomain.open"
      title="新增领域"
      cancel-text="取消"
      ok-text="新增并选择"
      @cancel="newDomain.open = false"
      @ok="confirmNewDomain"
    >
      <p>新增后立即生效，笔记仍需单独保存。</p>
      <label class="new-domain">
        <input
          ref="newDomainInput"
          v-model="newDomain.name"
          maxlength="20"
          placeholder="例如：健身"
          aria-label="新领域的名字"
          @input="newDomain.error = ''"
          @keydown.enter.prevent="confirmNewDomain"
        />
      </label>
      <div v-if="newDomain.error" class="new-domain-error">{{ newDomain.error }}</div>
    </NoticeDialog>

    <CropDialog
      v-if="cropping !== null"
      :images="pics.map((p, i) => ({ url: picUrls[i], crop: p.crop ?? null }))"
      :start="cropping"
      @done="onCropDone"
      @cancel="cropping = null"
    />

    <svg v-if="link" class="link-layer" aria-hidden="true">
      <path :d="link" />
      <!-- 两端各一个空心圆点 -->
      <circle :cx="link.split(' ')[1]" :cy="link.split(' ')[2]" r="3.5" />
      <circle :cx="link.split(' ').at(-2)" :cy="link.split(' ').at(-1)" r="3.5" />
    </svg>
  </main>
</template>

<style scoped>
.confirm {
  position: relative;
  height: calc(100vh - var(--titlebar-h));
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(300px, 30vw, 460px);
  gap: var(--panel-gap);
  padding: var(--window-pad);
  padding-top: 0;
}

/* 纸面和右栏共用的面板外观：由“层次”令牌决定是平铺还是卡片 */
.paper,
.side {
  background: var(--card);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}

.body :deep(a) {
  color: var(--accent);
}
.body :deep(.tableWrapper) {
  overflow-x: auto;
  margin-block: var(--sp-4);
}
.body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.body :deep(th),
.body :deep(td) {
  border: 1px solid var(--line-strong);
  padding: var(--sp-2);
  vertical-align: top;
}
.body :deep(th) {
  background: var(--card-muted);
  font-weight: var(--fw-title);
}
.body :deep(ul[data-type='taskList']) {
  padding-left: 0;
}
.body :deep(ul[data-type='taskList'] > li) {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding-left: 0;
}
.body :deep(ul[data-type='taskList'] > li)::before {
  content: none;
}
.body :deep(ul[data-type='taskList'] > li > label) {
  flex: none;
}
.body :deep(ul[data-type='taskList'] > li > div) {
  min-width: 0;
  flex: 1;
}
.body-raw {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: var(--note-preview-height);
  field-sizing: content;
  resize: vertical;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  color: var(--fg);
}
.body-notice {
  margin: 0 0 var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
}

/* ---------------- 左：纸面 ---------------- */
.paper {
  overflow-y: auto;
  view-transition-name: paper;
}
.paper-inner {
  /* 正文一行约 45 个中文字，读着不累；窗口再宽也只加两边留白 */
  max-width: 760px;
  margin: 0 auto;
  /* 窄窗口时留白跟着收小 */
  padding: var(--sp-5) clamp(var(--sp-5), 3.2vw, var(--sp-7)) var(--sp-7);
}

/* 可直接修改的标题和摘要：悬停时铅笔变深，点进去后出现编辑底色和焦点框 */
.editable {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: 0 calc(-1 * var(--sp-3));
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--radius-md);
  cursor: text;
  transition:
    background var(--ease),
    box-shadow var(--ease);
}
.editable:hover {
  background: var(--hover-soft);
}
.editable:focus-within {
  background: var(--card);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}
.editable textarea {
  /* 输入框按内容自动变宽变高，铅笔图标紧跟在文字后面 */
  field-sizing: content;
  overflow: hidden; /* 换行时不出现滚动条 */
  max-width: 100%;
  min-width: 2em;
  border: 0;
  padding: 0;
  background: none;
  resize: none;
  font: inherit;
  color: inherit;
  outline: none;
}
.edit-hint {
  flex: none;
  color: var(--faint);
  transition: color var(--ease);
}
.editable:hover .edit-hint {
  color: var(--muted);
}
.editable:focus-within .edit-hint {
  color: var(--accent);
}
/* 字号字重写在外层，输入框用 font: inherit 继承（写在输入框上会被 .editable textarea 覆盖） */
.title-line {
  /* 标题折行时两行长度接近，不会剩一两个字单独成行 */
  text-wrap: balance;
  font-size: var(--fs-2xl);
  font-weight: var(--fw-title);
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: var(--fg-strong);
}
.summary {
  margin-top: var(--sp-2);
  font-size: var(--fs-lg);
  line-height: 1.7;
  color: var(--muted);
}
.meta-row {
  /* 只读的一行：浅灰小字，和摘要一样低调 */
  width: 100%;
  height: auto;
  margin-top: var(--sp-2);
  padding: var(--sp-1) 0;
  /* 始终一行：窗口窄时来源信息末尾省略，不折行 */
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: left;
}
.meta-row:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.meta svg {
  flex: none;
  color: var(--faint);
}
.meta-source {
  min-width: 0;
}
.meta-source span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta-chip {
  flex: none;
}
.meta-chip {
  padding: 0 var(--sp-2);
  border-radius: var(--radius-chip);
  background: var(--chip-bg);
  line-height: 1.8;
}
.meta-sep {
  flex: none;
  width: 1px;
  height: 12px;
  margin: 0 var(--sp-1);
  background: var(--line);
}
.pics {
  --pic-max-w: 280px;
  --pic-max-h: 180px;
  margin-top: var(--sp-4);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--sp-3);
}
.pic-note {
  width: 100%;
}
.pic {
  container-type: inline-size;
  position: relative;
  margin: 0;
  flex-shrink: 0;
}
.pic-menu-open {
  z-index: 2;
}
.pic-crop {
  display: block;
  padding: 0;
  border: 0;
  cursor: zoom-in;
  position: relative;
  width: 100%;
  height: auto;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.pic-crop img {
  position: absolute;
  max-width: none;
  display: block;
  pointer-events: none;
  user-select: none;
}
/* 悬停或键盘聚焦时显示图片操作。 */
.pic-tools {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-5);
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: calc(100% - var(--sp-5) + var(--sp-2));
  opacity: 0;
  transition: opacity var(--ease);
}
.pic:hover .pic-tools,
.pic:focus-within .pic-tools {
  opacity: 1;
}
.pic-menu {
  display: none;
}
@container (max-width: 200px) {
  .pic button.pic-menu {
    position: absolute;
    top: var(--sp-1);
    left: var(--sp-1);
    display: block;
    height: var(--h-xs);
    padding-inline: var(--sp-2);
  }
  .pic .pic-tools {
    display: none;
  }
  .pic .pic-tools.menu-open {
    display: grid;
    top: calc(var(--h-xs) + var(--sp-2));
    left: var(--sp-1);
    right: auto;
    max-width: none;
    padding: var(--sp-1);
    background: var(--card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    z-index: 2;
    opacity: 1;
  }
}
.pic-tools button {
  height: var(--h-xs);
  max-width: 100%;
  padding: 0 var(--sp-2);
  white-space: nowrap;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: var(--shadow-card);
  font-size: var(--fs-sm);
}
.pic-resize {
  position: absolute;
  right: calc(var(--h-xs) / -2);
  bottom: calc(var(--h-xs) / -2);
  width: var(--h-xs);
  height: var(--h-xs);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: nwse-resize;
  touch-action: none;
  opacity: 0;
}
.pic-resize,
.pic-resize:hover:not(:disabled),
.pic-resize:active {
  background: transparent;
}
/* 键盘焦点由整张图片的外圈标示，避免手柄出现按钮状方框。 */
.pic-resize:focus-visible {
  outline: 0;
}
.pic-resize span {
  width: calc(var(--sp-2) + var(--sp-1) / 2);
  height: calc(var(--sp-2) + var(--sp-1) / 2);
  border: calc(var(--sp-1) / 4) solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow-card);
  pointer-events: none;
}
.pic-resize:hover span,
.pic-resize:focus-visible span,
.pic-resize:active span {
  border-color: var(--accent);
}
.pic:hover .pic-resize,
.pic:focus-within .pic-resize {
  opacity: 1;
}
.pic:hover .pic-crop,
.pic:focus-within .pic-crop {
  outline: calc(var(--sp-1) / 2) solid var(--accent);
  outline-offset: calc(var(--sp-1) / 2);
}
.pic-note {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--faint);
}
.toolbar-row {
  margin-top: var(--sp-4);
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--line);
}
.body-wrap {
  padding-top: var(--sp-1);
}

/* ---------------- 正文：所见即所得编辑器里的排版 ---------------- */
.body {
  font-size: var(--fs-lg);
  line-height: 1.7;
  color: var(--fg);
  /* 段落最后一行不只剩一两个字 */
  text-wrap: pretty;
}
.body :deep(.tiptap) {
  outline: none;
  counter-reset: section;
}
.body :deep(h3) {
  counter-increment: section;
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  /* 小标题属于下文：上方空得多、下方空得少 */
  margin: calc(var(--sp-6) + var(--sp-1)) 0 var(--sp-2);
  font-size: var(--fs-xl);
  font-weight: var(--fw-heading);
  line-height: 1.4;
  color: var(--fg-strong);
}
.body :deep(h3:first-child) {
  margin-top: var(--sp-2);
}
.body :deep(h3)::before {
  content: counter(section);
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-num);
  background: var(--num-bg);
  color: var(--num-fg);
  font-size: var(--fs-md);
  font-weight: 600;
}
/* “原文金句”这类后面紧跟引用的小标题：不编号，圆圈里放引号 */
.body :deep(h3:has(+ blockquote)) {
  counter-increment: none;
}
.body :deep(h3:has(+ blockquote))::before {
  content: '“';
  font-family: Georgia, 'Times New Roman', serif;
  font-size: var(--fs-deco);
  line-height: 1;
  padding-top: 12px;
  box-sizing: border-box;
}
/* 小标题下面的内容和小标题文字对齐（让出序号的宽度）；第一个小标题之前的开头段落不缩进 */
.body :deep(.tiptap > h3 ~ p),
.body :deep(.tiptap > h3 ~ ul),
.body :deep(.tiptap > h3 ~ ol),
.body :deep(.tiptap > h3 ~ blockquote) {
  margin-left: 48px;
}
.body :deep(p) {
  margin-top: var(--sp-1);
  margin-bottom: var(--sp-1);
}
.body :deep(ul) {
  list-style: none;
  margin-top: var(--sp-1);
  margin-bottom: var(--sp-1);
  padding: 0;
}
.body :deep(ul > li) {
  position: relative;
  padding-left: 20px;
  margin: var(--sp-1) 0;
}
.body :deep(ul > li)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0.8em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--bullet);
}
.body :deep(ol) {
  padding-left: 20px;
}
.body :deep(li p) {
  margin: 0;
}
.body :deep(strong) {
  font-weight: 700;
  color: var(--fg-strong);
}
.body :deep(blockquote) {
  margin-top: var(--sp-2);
  margin-bottom: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  background: var(--card-muted);
  border-radius: var(--radius-md);
}
.body :deep(blockquote p) {
  margin: 0;
}
/* 提示框（> [!info]- 图片中的文字）：藏起标记，标题加粗，整块用强调色浅底（见 editor/callout.ts） */
.body :deep(blockquote.callout) {
  background: var(--accent-soft);
}
.body :deep(.callout-mark) {
  display: none;
}
.body :deep(.callout-title) {
  font-weight: 600;
  color: var(--accent);
}
/* 对照时可点击的段落和当前点中的段落 */
.comparing .body :deep(li),
.comparing .body :deep(.tiptap > p),
.comparing .body :deep(blockquote p) {
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--ease);
}
.comparing .body :deep(li:hover),
.comparing .body :deep(.tiptap > p:hover) {
  background: var(--hover-soft);
}
.comparing .body :deep(li.is-linked),
.comparing .body :deep(p.is-linked) {
  background: var(--accent-soft);
}

/* ---------------- 右栏 ---------------- */
.side {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.video-panel {
  container: video-sidebar / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.video-player {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  border-radius: var(--panel-radius);
  background: var(--primary);
}
.video-capture {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--sp-2);
}
.video-unit {
  container-type: inline-size;
  min-width: 0;
}
.video-controls button.video-icon {
  min-width: var(--h-md);
  border-radius: var(--radius-md);
}
.expanded-video {
  width: min(85vw, 960px);
  max-height: 90vh;
  padding: var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  background: var(--card);
  color: var(--fg);
}
.expanded-video::backdrop {
  background: rgb(15 18 25 / 28%);
}
.expanded-video-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}
.expanded-video .video-unit {
  width: min(100%, calc(65vh * var(--video-aspect)));
  margin-inline: auto;
}
.expanded-video .video-player {
  aspect-ratio: var(--video-aspect);
  background: transparent;
}
.video-sound {
  position: relative;
  flex: none;
}
.video-volume-popup {
  position: absolute;
  z-index: 2;
  bottom: 100%;
  left: 50%;
  translate: -50% 0;
  display: grid;
  place-items: center;
  padding: var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card);
  opacity: 0;
  pointer-events: none;
}
.video-sound:hover .video-volume-popup,
.video-sound:focus-within .video-volume-popup {
  opacity: 1;
  pointer-events: auto;
}
.video-controls input.video-volume {
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: var(--sp-3);
  height: calc(var(--sp-7) * 2);
  margin: 0;
  background: transparent;
}
.video-volume::-webkit-slider-runnable-track {
  width: calc(var(--sp-1) / 2);
  border-radius: var(--radius-pill);
  background: var(--line-strong);
}
.video-volume::-webkit-slider-thumb {
  appearance: none;
  width: var(--sp-2);
  height: var(--sp-2);
  margin-inline: 0;
  margin-block-start: calc((var(--sp-1) / 2 - var(--sp-2)) / 2);
  border-radius: var(--radius-pill);
  background: var(--accent);
}
.video-icon {
  display: grid;
  place-items: center;
  flex: none;
  padding: 0 var(--sp-1);
  border: 0;
  background: transparent;
}

.video-heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.video-heading-row .frame-count {
  margin-inline-start: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: normal;
}
.video-heading {
  margin: 0;
}
.video-heading-row .video-capture-button,
.video-capture .video-capture-button {
  flex: none;
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}
.video-controls .video-capture-compact,
.compact-frame-separator {
  display: none;
}
@container video-sidebar (max-width: 340px) {
  .video-heading-row .video-capture-button {
    display: none;
  }
  .video-controls .video-capture-compact {
    display: inline-grid;
    place-items: center;
  }
  .compact-frame-separator {
    display: inline;
  }
  .video-controls {
    row-gap: var(--sp-1);
  }
  .video-heading-row {
    margin-top: var(--sp-2);
  }
}
.frame-count {
  margin-inline-start: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: normal;
}
.video-heading {
  margin: var(--sp-2) 0 0;
  font-size: inherit;
}
.image-preview {
  display: block;
  max-width: 100%;
  max-height: 60vh;
  margin-inline: auto;
  object-fit: contain;
}
.keep-video-option {
  display: flex;
  align-items: center;
  margin-top: var(--sp-3);
}
.keep-video-option input {
  margin: 0 var(--sp-2) 0 0;
  accent-color: var(--accent);
}
.video-size,
.video-status {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.video-status {
  margin: 0;
}
.video-frames {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.video-frame {
  position: relative;
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: var(--sp-1);
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .video-frame:hover .video-thumb {
    transform: scale(1.02);
  }
}
button.video-thumb {
  display: block;
  transition: transform 150ms ease-out;
  height: calc(var(--sp-7) * 3 * 9 / 16);
  padding: 0;
  border: 0;
  position: relative;
  width: calc(var(--sp-7) * 3);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--panel-radius);
}
.video-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.video-frame .frame-time {
  position: absolute;
  right: var(--sp-1);
  bottom: var(--sp-1);
  height: auto;
  padding: var(--sp-1);
  border: 0;
  border-radius: var(--sp-1);
  background: var(--primary);
  color: var(--card);
  font-size: var(--fs-sm);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.video-frame button.frame-time:hover:not(:disabled) {
  background: var(--primary-hover);
}
.video-frame button.frame-remove,
.pic button.frame-remove {
  position: absolute;
  top: 0;
  right: 0;
  transform: translate(35%, -35%);
  z-index: 1;
  display: grid;
  place-items: center;
  width: var(--sp-5);
  height: var(--sp-5);
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--err);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ease);
}
.frame-remove:hover:not(:disabled) {
  background: var(--err);
}
.frame-remove svg {
  transition: transform var(--ease);
}
@media (prefers-reduced-motion: no-preference) {
  .frame-remove:hover:not(:disabled) svg {
    transform: rotate(90deg);
  }
}
.pic:hover .frame-remove,
.pic:focus-within .frame-remove,
.video-frame:hover .frame-remove,
.video-frame:focus-within .frame-remove {
  opacity: 1;
  pointer-events: auto;
}
.video-thumb:focus-visible {
  outline: 1px solid var(--accent);
}
.video-controls input.video-progress {
  margin: 0;
}
@container (max-width: 340px) {
  .video-controls {
    flex-wrap: wrap;
  }
  .video-controls input.video-progress {
    order: -1;
    flex: 0 0 100%;
    width: 100%;
  }
  .video-controls .video-clock {
    margin-inline-end: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  button.frame-remove {
    transition: none;
  }
}

.tab-panels {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  isolation: isolate;
}
.tab-panels > .side-main {
  grid-area: 1 / 1;
}
@media (prefers-reduced-motion: no-preference) {
  .sidebar-tab-enter-active,
  .sidebar-tab-leave-active {
    transition: opacity 75ms ease;
  }
  .sidebar-tab-enter-active {
    transition-delay: 75ms;
  }
  .sidebar-tab-enter-from,
  .sidebar-tab-leave-to {
    opacity: 0;
  }
  .sidebar-tab-leave-active {
    pointer-events: none;
  }
}

.side-main {
  flex: 1;
  min-height: 0;
}
.props-area {
  overflow-y: auto;
  padding: var(--sp-5);
}
/* 右栏顶部的两个标签页：当前那个深色字、下面一条强调色细线 */
.tabs {
  position: relative;
  flex: none;
  display: flex;
  gap: var(--sp-5);
  margin: 0 var(--sp-5);
  padding-top: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.tab {
  height: var(--h-md);
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--faint);
}
.tab:focus:not(:focus-visible),
.tab:active:not(:disabled) {
  background: transparent;
  outline: none;
}
.pending-video-image {
  display: block;
  width: min(100%, calc(var(--sp-7) * 9));
}
.video-clock {
  color: var(--muted);
  font-size: var(--fs-sm);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.video-controls {
  margin-top: var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.video-controls input {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.video-progress:focus-visible {
  outline: none;
}
.video-progress:focus-visible::-webkit-slider-thumb {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}
.tab:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
}
.tab[aria-selected='true'] {
  color: var(--fg-strong);
  font-weight: var(--fw-label);
}
.tab {
  font-size: inherit;
  width: 4em;
}
.tab-indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 4em;
  height: 2px;
  background: var(--accent);
  pointer-events: none;
}
.tabs:has(.tab:nth-child(2)[aria-selected='true']) .tab-indicator {
  transform: translateX(calc(100% + var(--sp-5)));
}
.tabs:has(.tab:nth-child(3)[aria-selected='true']) .tab-indicator {
  transform: translateX(calc(200% + var(--sp-5) * 2));
}
@media (prefers-reduced-motion: no-preference) {
  .tab-indicator {
    transition: transform 150ms cubic-bezier(0.2, 0, 0, 1);
  }
}
/* 文件名（右栏第一行）：和下面的属性一样的小标题，下面一个输入框，后缀 .md 淡色 */
.file-field {
  display: block;
  margin-bottom: var(--sp-5);
}
.name-input {
  display: flex;
  align-items: center;
  height: var(--h-md);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.name-input:focus-within {
  background: var(--card);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}
.name-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--fg);
}
.ext {
  color: var(--faint);
}
.source {
  margin-top: var(--sp-6);
}
.file-field h3,
.source h3 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-md);
  font-weight: var(--fw-label);
  color: var(--fg-strong);
}
.facts {
  margin: 0;
  padding: var(--sp-1) var(--sp-4);
  background: var(--card-muted);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.attachment-heading,
.note-attachments li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.attachment-heading {
  justify-content: space-between;
  margin-top: var(--sp-5);
}
.attachment-heading h3 {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin: 0;
}
.attachment-add {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.note-attachments {
  margin-top: var(--sp-2);
  list-style: none;
}
.note-attachments li > svg {
  color: var(--faint);
}
.note-attachments li + li {
  border-top: 1px solid var(--line);
}
.note-attachments li {
  min-height: var(--h-md);
}
.note-attachments li > :not(.attachment-name) {
  flex: none;
}
.note-attachments .attachment-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-attachments .attachment-open {
  height: var(--h-sm);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
}
.note-attachments .attachment-open:hover:not(:disabled),
.note-attachments .attachment-open:focus-visible {
  background: transparent;
  text-decoration: underline;
}
.attachment-status {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
}
.fact + .fact {
  border-top: 1px solid var(--line);
}
.fact dt {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--faint);
  white-space: nowrap;
}
.fact dd {
  margin: 0;
  color: var(--fg);
  text-align: right;
}
.fact .file {
  overflow-wrap: anywhere;
}
.fact .link-text {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--h-xs);
  min-width: 0;
  gap: var(--sp-1);
  white-space: nowrap;
}
.editing-source .link-text {
  flex: 1;
}
.fact .link-text input {
  box-sizing: border-box;
  min-width: 0;
  width: 0;
  flex: 1;
  height: var(--h-xs);
  padding-inline: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--fg);
  font: inherit;
}
.fact .link-text input:focus {
  border-color: var(--accent);
  outline: none;
}
.fact .link-text button {
  flex: none;
}
.fact .link-text a,
.fact .link-text span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--accent);
}
/* 底部操作：右栏最下面，两种状态下位置不变 */
.actions {
  flex: none;
  padding: var(--sp-4) var(--sp-5);
  border-top: 1px solid var(--line);
  view-transition-name: actions;
}
.action-row {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
}
.btn {
  /* 底部两个按钮等宽，靠颜色区分主次，不靠长短 */
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--h-md);
  padding: 0 var(--px-md);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  white-space: nowrap;
}
.btn-primary {
  gap: var(--sp-2);
  border: 0;
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}
.btn-primary:disabled {
  background: var(--hover);
  border-color: transparent;
  color: var(--faint);
  opacity: 1;
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.kbd {
  font-weight: 400;
  font-size: var(--fs-xs);
  opacity: 0.7;
}
.btn-secondary {
  /* 次按钮不加边框，浅灰底，和整体的轻盈一致 */
  border: 0;
  background: var(--hover);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--line);
}
.btn-danger {
  border: 0;
  background: var(--err);
  color: var(--on-primary);
  font-weight: 600;
}
.btn-danger:hover:not(:disabled) {
  background: var(--err-hover);
}
.discard-ask {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--fg);
}
.save-to {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--faint);
}
.save-to svg {
  flex: none;
}
.save-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.save-domain {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}
.save-fail {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.save-fail svg,
.save-fail b {
  flex: none;
  color: var(--err);
  font-weight: 500;
}
.save-fail span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.save-fail .link {
  flex: none;
  padding: 0;
  font-size: inherit;
}
.field-error {
  margin: var(--sp-2) 0;
  font-size: var(--fs-sm);
  color: var(--err);
}

/* 正文到原文的连线 */
.link-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.link-layer path {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  opacity: 0.55;
}
.link-layer circle {
  fill: var(--card);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.new-domain {
  display: flex;
  height: var(--h-md);
  margin-top: var(--sp-3);
  padding: 0 var(--px-sm);
  border-radius: var(--radius-md);
  background: var(--card-muted);
  transition:
    background var(--ease),
    box-shadow var(--ease);
}
.new-domain:focus-within {
  background: var(--card);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}
.new-domain input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--fg);
}
.new-domain input::placeholder {
  color: var(--faint);
}
.new-domain-error {
  margin-top: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--err);
}

/* ---------------- 打开已有笔记（F22）---------------- */
.back {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: var(--sp-6);
  margin: 0 0 var(--sp-1) calc(-1 * var(--sp-1));
  padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-1);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted);
  font-size: var(--fs-action);
  cursor: pointer;
}
.back::before {
  content: '';
  position: absolute;
  inset: calc(-1 * (var(--h-md) + var(--sp-2) - var(--sp-6)) / 2) 0;
}
.back:hover {
  background: none;
  color: var(--fg);
}
.pic-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  width: 240px;
  height: 160px;
  border-radius: var(--radius-md);
  background: var(--card-muted);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.open-obsidian {
  margin-top: var(--sp-5);
}
.open-obsidian svg {
  margin-right: var(--sp-2);
}
.btn-delete {
  color: var(--err);
}
.action-row .btn svg {
  margin-right: var(--sp-1);
}
</style>
