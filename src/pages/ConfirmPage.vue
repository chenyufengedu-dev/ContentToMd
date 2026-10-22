<script setup lang="ts">
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
} from 'lucide-vue-next'
import type { Config } from '../core/config'
import type { Job } from '../core/pipeline'
import { buildMarkdown, safeFileTitle, today, type NoteDraft, type NoteImage } from '../core/note'
import { cropForSave, type Rect } from '../core/image'
import { saveFailure, type SaveFailure } from '../core/saveFailure'
import { matchToSource } from '../core/sourceMatch'
import { removeAttachment, writeAttachment, writeNote } from '../shell/tauri'
import { editorExtensions, fixCallouts } from '../editor/extensions'
import { linkedBlockKey } from '../editor/linkedBlock'
import NoteProps from '../components/NoteProps.vue'
import SourcePanel from '../components/SourcePanel.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import CropDialog from '../components/CropDialog.vue'
import NoticeDialog from '../components/NoticeDialog.vue'

const props = defineProps<{ config: Config; job: Job; existingTags: string[] }>()
/** 保存成功页要用的：笔记相对收藏库的路径、没写进去的图片（比如“第 2 张”），以及左边预览框的文字 */
export interface SavedNote {
  path: string
  failedImages: string[]
  title: string
  summary: string
  text: string
}
/** edited：确认页改到一半的内容，由投放页存进草稿 */
const emit = defineEmits<{ saved: [SavedNote]; discard: []; goSettings: []; edited: [NoteDraft] }>()

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
const created = today()
const transcript = props.job.transcript ?? ''

// ---------------- 图片（F29）----------------
// 图片放在正文前面，按裁剪框显示；悬停时可以调整裁剪或恢复原图
const pics = props.job.images ?? []
const picUrls = pics.map((p) => URL.createObjectURL(p.file))
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
    fig: { width: `min(100%, calc(var(--pic-max-h) * ${c.w / c.h}))` },
    img: {
      width: `${(n.w / c.w) * 100}%`,
      height: `${(n.h / c.h) * 100}%`,
      left: `${(-c.x / c.w) * 100}%`,
      top: `${(-c.y / c.h) * 100}%`,
    },
  }
}
const sameRect = (a?: Rect | null, b?: Rect | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const cropNote = computed(() => {
  const p = pics[0]
  if (!p?.autoCrop) return ''
  if (sameRect(p.crop, p.autoCrop)) return '已自动裁掉状态栏和空白边'
  return p.crop ? '已按你的调整裁剪' : '已恢复原图'
})
const cropping = ref<number | null>(null)
function onCropDone(crops: (Rect | null)[]) {
  crops.forEach((c, i) => (pics[i].crop = c))
  cropping.value = null
  rememberEdits()
}

const editor = useEditor({
  extensions: editorExtensions(),
  content: start.body,
  contentType: 'markdown',
  onUpdate: () => rememberEdits(),
})

// 改动停下来 0.8 秒后存进草稿，软件意外关掉也不丢（F10）
let draftTimer: number | undefined
function rememberEdits() {
  clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    if (!editor.value) return
    emit('edited', {
      ...d,
      ...form,
      tags: [...form.tags],
      keywords: [...form.keywords],
      body: fixCallouts(editor.value.getMarkdown()),
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
// 用浏览器的视图过渡让这次切换平滑（WebView2 支持；不支持时直接切换）
const comparing = ref(false)
function setComparing(on: boolean) {
  if (on === comparing.value) return
  let applied = false
  const apply = async () => {
    if (applied) return
    applied = true
    comparing.value = on
    if (!on) clearLink()
    else refreshCoverage()
    await nextTick()
  }
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown }
  if (!doc.startViewTransition) return void apply()
  doc.startViewTransition(apply)
  // 窗口不在绘制时（比如被挡住）视图过渡可能迟迟不开始，0.5 秒后直接切换，不让界面卡住
  setTimeout(() => void apply(), 500)
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

const active = ref<{ from: number; to: number } | 'none' | null>(null)

/** 在编辑器里标出点中的段落（用编辑器的装饰，见 linkedBlock.ts）；pos 为 null 时清除 */
function markBlock(pos: number | null) {
  const view = editor.value?.view
  if (view) view.dispatch(view.state.tr.setMeta(linkedBlockKey, pos))
}
const linkedEl = () => paperEl.value?.querySelector<HTMLElement>('.is-linked') ?? null

/** 对照时点击正文的一段：原文里对应的句子高亮，并画一条连线（F30） */
function onBodyClick(e: MouseEvent) {
  if (!comparing.value) return
  // 列表项里面还包着一层段落，点到的通常是里面那层，所以先找列表项
  const target = e.target as HTMLElement
  const block = target.closest<HTMLElement>('li') ?? target.closest<HTMLElement>('p')
  const blocks = bodyBlocks()
  const idx = block ? blocks.indexOf(block) : -1
  if (idx < 0 || !editor.value) {
    clearLink()
    return
  }
  refreshCoverage() // 正文可能刚改过
  // 段落或列表项在编辑器里的起点：元素内部的位置减一
  markBlock(editor.value.view.posAtDOM(blocks[idx], 0) - 1)
  active.value = coverage.value.matches[idx] ?? 'none'
  void nextTick(() => setTimeout(updateLink, 350)) // 等原文滚动到位
}

function clearLink() {
  markBlock(null)
  active.value = null
  link.value = null
}

// 连线：从正文段落右边连到原文句子左边；任何一头滚出可视区就不画
const confirmEl = ref<HTMLElement>()
const paperEl = ref<HTMLElement>()
const panel = ref<InstanceType<typeof SourcePanel>>()
const link = ref<string | null>(null)
function updateLink() {
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
const domainName = computed(() => props.config.domains.find((x) => x.id === form.domainId)?.name ?? '其他')

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 图片按裁剪框写进 附件/年-月/（方案第 10.4 节）。写不进去的跳过并记下，笔记照样保存 */
async function writeImages(title: string): Promise<{ images: NoteImage[]; written: string[]; failed: string[] }> {
  const images: NoteImage[] = []
  const written: string[] = []
  const failed: string[] = []
  const base = safeFileTitle(title).slice(0, 20)
  for (const [i, p] of pics.entries()) {
    try {
      const blob = await cropForSave(p.file, p.crop ?? null)
      const ext = EXT[blob.type] ?? p.file.name.split('.').pop() ?? 'png'
      const name = `${created}-${base}-${i + 1}.${ext}`
      const rel = await writeAttachment(props.config.vaultPath, created.slice(0, 7), name, blob)
      written.push(rel)
      images.push({ path: `../${rel}`, caption: d.image_captions[i] ?? '' })
    } catch {
      failed.push(`第 ${i + 1} 张`)
    }
  }
  return { images, written, failed }
}

async function save() {
  if (saving.value || titleMissing.value || !editor.value) return
  saving.value = true
  saveError.value = null
  const title = form.title.trim()
  const { images, written, failed } = await writeImages(title)
  const md = buildMarkdown(
    {
      title,
      domainId: form.domainId,
      tags: form.tags,
      keywords: form.keywords,
      summary: form.summary.trim(),
      body: fixCallouts(editor.value.getMarkdown()).trim(),
      image_captions: d.image_captions,
    },
    {
      domain: domainName.value,
      type: props.job.type,
      mode: props.job.mode,
      source: props.job.source ?? '',
      platform: props.job.platform ?? '',
      author: props.job.author ?? '',
      created,
      cover: images[0]?.path ?? '',
    },
    images,
  )
  try {
    const rel = await writeNote(props.config.vaultPath, domainName.value, safeFileTitle(title), created, md)
    emit('saved', {
      path: rel,
      failedImages: failed,
      title,
      summary: form.summary.trim(),
      text: editor.value.getText({ blockSeparator: '\n' }),
    })
  } catch (e) {
    // 保存失败时编辑中的内容保留（方案第 7 节）；刚写进去的图片删掉，不留没人引用的文件
    for (const rel of written) await removeAttachment(props.config.vaultPath, rel).catch(() => {})
    saveError.value = saveFailure(String(e))
    failDialog.value = true
  } finally {
    saving.value = false
  }
}

const confirmingDiscard = ref(false)

// 快捷键：Ctrl+S 保存；Esc 先收起原文，再关放弃确认（方案第 11 节）
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  } else if (e.key === 'Escape') {
    if (failDialog.value) return // 提示框自己处理 Esc
    if (comparing.value) setComparing(false)
    else confirmingDiscard.value = false
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', updateLink)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', updateLink)
  clearTimeout(draftTimer)
  editor.value?.destroy()
  picUrls.forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <main ref="confirmEl" class="confirm" :class="{ comparing }">
    <article ref="paperEl" class="paper" @scroll="updateLink">
      <div class="paper-inner">
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
          <Pencil class="edit-hint" :size="20" aria-hidden="true" />
        </label>
        <p v-if="titleMissing" class="field-error">标题不能为空</p>

        <label class="editable summary" style="view-transition-name: note-summary">
          <textarea v-model="form.summary" rows="1" aria-label="这条讲什么" placeholder="一句话说清这条讲什么" />
          <Pencil class="edit-hint" :size="16" aria-hidden="true" />
        </label>

        <!-- 对照原文时才出现：右栏属性的只读摘要，点一下回到属性信息去修改 -->
        <button
          v-if="comparing"
          class="meta-row"
          style="view-transition-name: meta-row"
          title="在右边的属性信息里修改"
          @click="setComparing(false)"
        >
          <span class="meta"><Folder :size="14" aria-hidden="true" />{{ domainName }}</span>
          <span v-for="t in form.tags" :key="t" class="meta-chip">{{ t }}</span>
          <span class="meta-sep" aria-hidden="true" />
          <span class="meta meta-source"
            ><Video :size="14" aria-hidden="true" /><span>{{
              [job.fileName, duration, '语音转写', created].filter(Boolean).join(' · ')
            }}</span></span
          >
        </button>

        <div v-if="pics.length" class="pics">
          <figure v-for="(p, i) in pics" :key="picUrls[i]" class="pic" :style="cropView(i).fig">
            <div class="pic-crop" :style="cropView(i).box">
              <img
                :src="picUrls[i]"
                :alt="d.image_captions[i] ?? ''"
                :style="cropView(i).img"
                @load="onPicLoad(i, $event)"
              />
            </div>
            <div class="pic-tools">
              <button @click="cropping = i">调整裁剪</button>
              <button v-if="p.crop" @click="p.crop = null">恢复原图</button>
            </div>
          </figure>
          <p v-if="cropNote" class="pic-note">{{ cropNote }}</p>
        </div>

        <div class="toolbar-row">
          <EditorToolbar v-if="editor" :editor="editor" />
        </div>

        <div class="body-wrap" style="view-transition-name: note-body">
          <EditorContent :editor="editor" class="body" @click="onBodyClick" />
        </div>
      </div>
    </article>

    <aside class="side">
      <div class="tabs" role="tablist" aria-label="右栏">
        <!-- 图片没有转写原文，只有属性信息 -->
        <button v-if="transcript" role="tab" class="tab" :aria-selected="comparing" @click="setComparing(true)">
          原文对照
        </button>
        <button role="tab" class="tab" :aria-selected="!comparing" @click="setComparing(false)">属性信息</button>
      </div>

      <div v-if="!comparing" class="side-main props-area" style="view-transition-name: props-card">
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
        />

        <div class="source">
          <h3>来源信息</h3>
          <dl class="facts">
            <div v-if="pics.length" class="fact">
              <dt><ImageIcon :size="16" />图片</dt>
              <dd>{{ pics.length }} 张</dd>
            </div>
            <div v-else class="fact">
              <dt><Video :size="16" />{{ job.type }}文件</dt>
              <dd class="file">{{ job.fileName }}</dd>
            </div>
            <div v-if="duration" class="fact">
              <dt><Clock :size="16" />时长</dt>
              <dd>{{ duration }}</dd>
            </div>
            <div class="fact">
              <dt><FileText :size="16" />整理方式</dt>
              <dd>{{ job.mode }}</dd>
            </div>
            <div v-if="!pics.length" class="fact">
              <dt><Mic :size="16" />内容来自</dt>
              <dd>语音转写</dd>
            </div>
            <div v-if="job.source" class="fact">
              <dt><Link2 :size="16" />来源链接</dt>
              <dd class="file link-text" :title="job.source">{{ job.source }}</dd>
            </div>
            <div class="fact">
              <dt><CalendarDays :size="16" />收藏日期</dt>
              <dd>{{ created }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <SourcePanel
        v-else
        ref="panel"
        class="side-main"
        style="view-transition-name: source-panel"
        :sentences="coverage.sentences"
        :unused="coverage.unused"
        :active="active"
        @scroll="updateLink"
      />

      <footer class="actions">
        <p v-if="saveError && !failDialog" class="save-fail">
          <CircleAlert :size="14" aria-hidden="true" />
          <span><b>没有保存：</b>{{ saveError.reason }}</span>
          <template v-if="saveError.toSettings">
            ·<button class="link" @click="emit('goSettings')">去设置</button>
          </template>
        </p>
        <template v-if="confirmingDiscard">
          <p class="discard-ask">确定放弃这一条吗？已整理的内容不会保存。</p>
          <div class="action-row">
            <button class="btn btn-secondary" @click="confirmingDiscard = false">取消</button>
            <button class="btn btn-danger" @click="emit('discard')">放弃这一条</button>
          </div>
        </template>
        <div v-else class="action-row">
          <button class="btn btn-secondary" @click="confirmingDiscard = true">放弃</button>
          <button class="btn btn-primary" :disabled="saving || titleMissing" @click="save">
            {{ saving ? '保存中…' : saveError ? '重新保存' : '保存' }}<span class="kbd">Ctrl+S</span>
          </button>
        </div>
      </footer>
    </aside>

    <NoticeDialog
      v-if="failDialog && saveError"
      title="没有保存"
      tone="error"
      cancel-text="知道了"
      ok-text="重新保存"
      @cancel="failDialog = false"
      @ok="save"
    >
      <p>{{ saveError.reason }}</p>
      <p v-if="saveError.toSettings">
        到<button class="link" @click="emit('goSettings')">设置</button>{{ saveError.next.replace(/^到设置/, '') }}
      </p>
      <p v-else>{{ saveError.next }}</p>
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
.confirm.comparing {
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr);
}

/* 纸面和右栏共用的面板外观：由“层次”令牌决定是平铺还是卡片 */
.paper,
.side {
  background: var(--card);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
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
  color: var(--line-strong);
  transition: color var(--ease);
}
.editable:hover .edit-hint {
  color: var(--faint);
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
  --pic-max-h: 240px; /* 所有图片按这个高度显示，宽度按比例，太宽时缩到正文宽度；多张时并排 */
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
  position: relative;
  margin: 0;
}
.pic-crop {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.pic-crop img {
  position: absolute;
  max-width: none;
  display: block;
}
/* 悬停时右上角浮出两个小按钮 */
.pic-tools {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  display: flex;
  gap: var(--sp-1);
  opacity: 0;
  transition: opacity var(--ease);
}
.pic:hover .pic-tools,
.pic:focus-within .pic-tools {
  opacity: 1;
}
.pic-tools button {
  height: var(--h-xs);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 92%);
  box-shadow: var(--shadow-card);
  font-size: var(--fs-sm);
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
  box-shadow: inset 0 -2px 0 transparent;
}
.tab:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
}
.tab[aria-selected='true'] {
  color: var(--fg-strong);
  font-weight: var(--fw-label);
  box-shadow: inset 0 -2px 0 var(--accent);
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
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card);
}
.name-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-wrap: normal;
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
  height: var(--h-md);
  padding: 0 var(--px-md);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  white-space: nowrap;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  border: 0;
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.btn-primary:disabled {
  background: var(--line-strong);
  opacity: 1;
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
.discard-ask {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--fg);
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
</style>
