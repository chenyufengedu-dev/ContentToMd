<script setup lang="ts">
import { UNSAVED_CHANGES, LEAVE_CHANGES_WARNING } from '../core/editMessages'
// 笔记页（F22）：在收藏库里点一条笔记进来，直接复用确认页的界面修改正文和属性、改领域、删除。
// 这里管读笔记、读图片、删除确认、有改动还没保存时的提示；编辑和保存在 ConfirmPage 里
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert } from '../components/icons'
import { type Config, type Domain, nextDomainId, notesRoot, OTHER_DOMAIN_ID } from '../core/config'
import { resolveAttachment } from '../core/library'
import { parseNoteBody } from '../core/note'
import type { Job, JobImage } from '../core/pipeline'
import {
  clearEditRecovery,
  listEditRecoveries,
  deleteNote,
  destroyWindow,
  guardClose,
  listVaultTags,
  openNote,
  readCover,
  readNote,
} from '../shell/tauri'
import { RECOVERY_CLEAR_ERROR, type NoteRecovery } from '../core/noteRecovery'
import ConfirmPage, { type EditInfo } from './ConfirmPage.vue'
import NoticeDialog from '../components/NoticeDialog.vue'

const props = defineProps<{ config: Config; path: string }>()
const emit = defineEmits<{
  /** deleted：笔记已经删了，收藏库页要重新读 */
  back: [changed: boolean]
  /** 删除成功：笔记和图片已放进回收站，由外面给“撤销”的提示 */
  deleted: [info: { path: string; images: string[] }]
  configChanged: [Config]
  goSettings: []
  dirty: [boolean]
}>()

const root = computed(() => notesRoot(props.config))
const path = ref(props.path)
const state = ref<'loading' | 'recovery' | 'ready' | 'gone' | 'error'>('loading')
const pendingRecovery = ref<NoteRecovery | null>(null)
const recovery = ref<NoteRecovery>()
const editorPage = ref<InstanceType<typeof ConfirmPage>>()
const recoveryError = ref('')
async function discardEdits() {
  if (editorPage.value) {
    const discarded = await editorPage.value.discardRecovery()
    if (!discarded) recoveryError.value = RECOVERY_CLEAR_ERROR
    return discarded
  }
  return false
}
defineExpose({ discardEdits })
async function leaveWithoutSaving(close = false) {
  if (!(await discardEdits())) return
  if (close) await destroyWindow()
  else emit('back', changed.value)
}
async function chooseRecovery(restore: boolean) {
  const record = pendingRecovery.value
  if (!record) return
  if (restore) {
    const restored = { ...record, images: record.images.map((image) => ({ ...image })) }
    for (const [index, image] of (job.value?.images ?? []).entries()) {
      const originalIndex = image.noteImageIndex ?? index
      const saved = restored.images.find((entry) => entry.index === originalIndex)
      if (!saved) continue
      // 已落盘的裁剪已体现在当前附件中，不再裁第二次。
      if (JSON.stringify(saved.crop) === JSON.stringify(saved.savedCrop)) {
        saved.crop = null
        saved.savedCrop = null
        saved.source = edit.value?.images[originalIndex]?.path
        continue
      }
      if (!saved.source || saved.source === edit.value?.images[originalIndex]?.path) continue
      try {
        const rel = resolveAttachment(record.path, saved.source)
        const blob = await readCover(root.value, rel)
        if (loading.signal.aborted) return
        image.file = new File([blob], rel.split('/').pop() ?? 'image', { type: imageType(rel) })
      } catch {
        recoveryError.value = '裁剪所需原图无法读取，请检查附件后重试。未保存的修改已保留。'
        return
      }
    }
    recovery.value = restored
  } else {
    try {
      await clearEditRecovery(root.value, path.value)
    } catch (error) {
      recoveryError.value = String(error)
      return
    }
  }
  state.value = 'ready'
}
const errorText = ref('')
const job = ref<Job>()
const edit = ref<EditInfo>()
/** 笔记所在的文件夹不是设置里的领域时，临时加进去，不然领域下拉里没有它，一保存就被改成“其他” */
const cfg = ref(props.config)
const changed = ref(false)
const existingTags = ref<string[]>([])

const imageType = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext ? `image/${ext}` : ''
}

// 关窗口时有没保存的修改也要问
const askClose = ref(false)
let unguard: (() => void) | undefined
const loading = new AbortController()
onBeforeUnmount(() => {
  loading.abort()
  unguard?.()
})

onMounted(async () => {
  listVaultTags(root.value)
    .then((t) => {
      if (!loading.signal.aborted) existingTags.value = t
    })
    .catch(() => {})
  try {
    try {
      pendingRecovery.value =
        (await listEditRecoveries()).find((r) => r.root === root.value && r.path === path.value) ?? null
    } catch (error) {
      recoveryError.value = `恢复副本暂时无法读取：${String(error)}。`
    }
    if (loading.signal.aborted) return
    const f = await readNote(root.value, path.value)
    if (loading.signal.aborted) return
    const { summary, images, body } = parseNoteBody(f.content)
    let domain = props.config.domains.find((d) => d.name === f.domain)
    if (!domain) {
      domain = { id: nextDomainId(props.config.domains), name: f.domain } as Domain
      const list = props.config.domains
      const at = list.findIndex((d) => d.id === OTHER_DOMAIN_ID)
      cfg.value = {
        ...props.config,
        domains: at < 0 ? [...list, domain] : [...list.slice(0, at), domain, ...list.slice(at)],
      }
    }
    const files: JobImage[] = []
    let missing = 0
    for (const [noteImageIndex, img] of images.entries()) {
      const rel = resolveAttachment(path.value, img.path)
      try {
        const blob = await readCover(root.value, rel)
        if (loading.signal.aborted) return
        const name = rel.split('/').pop() ?? 'image'
        files.push({ file: new File([blob], name, { type: imageType(name) }), noteImageIndex, width: img.width })
      } catch {
        if (loading.signal.aborted) return
        missing++
      }
    }
    job.value = {
      fileName: f.stem,
      type: f.kind,
      mode: f.mode,
      steps: [],
      images: files,
      draft: {
        title: f.title,
        domainId: domain.id,
        tags: f.tags,
        keywords: f.keywords,
        summary,
        body,
        image_captions: images.map((i) => i.caption),
      },
    }
    edit.value = {
      originalText: f.originalText,
      path: path.value,
      stem: f.stem,
      meta: {
        domain: f.domain,
        type: f.kind,
        mode: f.mode,
        source: f.source,
        platform: f.platform,
        author: f.author,
        created: f.created,
        cover: f.cover,
        extra: f.extra,
      },
      images,
      missing,
      canOpen: props.config.vault.kind === 'obsidian',
    }
    state.value = pendingRecovery.value ? 'recovery' : 'ready'
  } catch (e) {
    if (loading.signal.aborted) return
    errorText.value = String(e)
    state.value = /找不到/.test(errorText.value) ? 'gone' : 'error'
  }
  // 放在最后：浏览器预览里没有窗口，这一句会直接报错
  guardClose(
    () => isDirty.value,
    () => (askClose.value = true),
  )
    .then((f) => {
      if (loading.signal.aborted) f()
      else unguard = f
    })
    .catch(() => {})
})

// ---- 保存后：领域或文件名变了，笔记的位置也变了 ----
function onUpdated(rel: string) {
  path.value = rel
  if (edit.value) edit.value = { ...edit.value, path: rel, stem: rel.split('/').pop()!.replace(/\.md$/, '') }
  changed.value = true
}

function onConfigChanged(c: Config) {
  cfg.value = c
  emit('configChanged', c)
}

// ---- 有改动还没保存时离开 ----
const isDirty = ref(false)
const askLeave = ref(false)
function onDirty(v: boolean) {
  isDirty.value = v
  emit('dirty', v)
}
function back() {
  if (isDirty.value) askLeave.value = true
  else emit('back', changed.value)
}

// ---- 删除 ----
const askDelete = ref(false)
const deleteError = ref('')
async function remove() {
  deleteError.value = ''
  try {
    const images = await deleteNote(root.value, path.value)
    await editorPage.value?.discardRecovery()
    emit('deleted', { path: path.value, images })
  } catch (e) {
    deleteError.value = String(e)
  }
}

const openError = ref('')
const openInObsidian = () =>
  openNote(root.value, path.value, true).catch((e) => {
    openError.value = String(e)
  })
</script>

<template>
  <p v-if="state === 'loading'" class="hint">正在打开…</p>
  <ConfirmPage
    v-else-if="state === 'ready' && job && edit"
    ref="editorPage"
    :recovery="recovery"
    :config="cfg"
    :job="job"
    :edit="edit"
    :existing-tags="existingTags"
    @updated="onUpdated"
    @back="back"
    @remove="askDelete = true"
    @open="openInObsidian"
    @dirty="onDirty"
    @go-settings="emit('goSettings')"
    @config-changed="onConfigChanged"
  />

  <NoticeDialog
    v-if="state === 'gone' || state === 'error'"
    :title="state === 'gone' ? '找不到这篇笔记' : '笔记打开失败'"
    :tone="state === 'gone' ? 'info' : 'error'"
    cancel-text="知道了"
    ok-text="返回收藏库"
    @cancel="emit('back', true)"
    @ok="emit('back', true)"
  >
    <p v-if="state === 'gone'">文件可能已被移动或删除。</p>
    <p v-else>{{ errorText }}</p>
    <template v-if="pendingRecovery">
      <p>未保存的正文仍保留，可在下方复制。</p>
      <textarea class="recovery-copy" aria-label="恢复正文（只读）" readonly :value="pendingRecovery.draft.body" />
    </template>
  </NoticeDialog>

  <NoticeDialog
    v-if="askDelete"
    title="删除这篇笔记？"
    tone="error"
    danger
    cancel-text="取消"
    ok-text="删除"
    @cancel="askDelete = false"
    @ok="remove"
  >
    <p>笔记及仅由它引用的图片将移入 Windows 回收站。删除后可撤销，也可从回收站恢复。</p>
    <p v-if="deleteError" class="err"><CircleAlert :size="14" aria-hidden="true" />{{ deleteError }}</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="askLeave"
    :title="UNSAVED_CHANGES"
    cancel-text="继续编辑"
    ok-text="不保存，离开"
    @cancel="askLeave = false"
    @ok="leaveWithoutSaving()"
  >
    <p>{{ LEAVE_CHANGES_WARNING }}</p>
    <p v-if="recoveryError" class="err">{{ recoveryError }}</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="askClose"
    title="放弃修改并关闭？"
    cancel-text="继续编辑"
    ok-text="不保存并关闭"
    @cancel="askClose = false"
    @ok="leaveWithoutSaving(true)"
  >
    <p>本次修改将丢失，已保存的笔记不受影响。</p>
    <p v-if="recoveryError" class="err">{{ recoveryError }}</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="state === 'recovery' && pendingRecovery"
    title="上次编辑未正常结束"
    dismiss-to-neutral
    cancel-text="放弃修改"
    ok-text="恢复修改"
    @neutral="emit('back', false)"
    @cancel="chooseRecovery(false)"
    @ok="chooseRecovery(true)"
  >
    <p>“{{ pendingRecovery.draft.title }}”有未保存的修改，可恢复。</p>
    <p>恢复后仍需保存；放弃将丢失这些修改。</p>
    <p v-if="pendingRecovery.originalText !== edit?.originalText">
      笔记已在其他程序修改，恢复内容不能直接覆盖。请复制需要的内容，再重新打开笔记。
    </p>
    <template v-if="recoveryError">
      <p class="err">{{ recoveryError }}</p>
      <textarea class="recovery-copy" aria-label="恢复正文（只读）" readonly :value="pendingRecovery.draft.body" />
    </template>
  </NoticeDialog>
  <p v-if="openError || recoveryError" class="open-error" role="alert">{{ openError || recoveryError }}</p>
</template>

<style scoped>
.hint {
  padding: var(--sp-6);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.recovery-copy {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--note-preview-height);
  font: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--sp-2);
}
.err {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--err);
}
.open-error {
  position: fixed;
  bottom: var(--sp-4);
  left: 50%;
  transform: translateX(-50%);
  color: var(--err);
  font-size: var(--fs-sm);
}
</style>
