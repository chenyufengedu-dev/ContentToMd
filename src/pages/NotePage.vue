<script setup lang="ts">
// 笔记页（F22）：在收藏库里点一条笔记进来，直接复用确认页的界面修改正文和属性、改领域、删除。
// 这里管读笔记、读图片、删除确认、有改动还没保存时的提示；编辑和保存在 ConfirmPage 里
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert } from '../components/icons'
import { type Config, type Domain, nextDomainId, notesRoot, OTHER_DOMAIN_ID } from '../core/config'
import { resolveAttachment } from '../core/library'
import { parseNoteBody } from '../core/note'
import type { Job, JobImage } from '../core/pipeline'
import { deleteNote, destroyWindow, guardClose, listVaultTags, openNote, readCover, readNote } from '../shell/tauri'
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
const state = ref<'loading' | 'ready' | 'gone' | 'error'>('loading')
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
    state.value = 'ready'
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
    :title="state === 'gone' ? '这条笔记已经不在了' : '没能打开这条笔记'"
    :tone="state === 'gone' ? 'info' : 'error'"
    cancel-text="知道了"
    ok-text="回到收藏库"
    @cancel="emit('back', true)"
    @ok="emit('back', true)"
  >
    <p v-if="state === 'gone'">它可能被移走或在别的程序里删除了。</p>
    <p v-else>{{ errorText }}</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="askDelete"
    title="删除这条笔记？"
    tone="error"
    danger
    cancel-text="取消"
    ok-text="删除"
    @cancel="askDelete = false"
    @ok="remove"
  >
    <p>这条笔记和只有它在用的图片会被放进 Windows 回收站，需要时可以从回收站恢复。</p>
    <p v-if="deleteError" class="err"><CircleAlert :size="14" aria-hidden="true" />{{ deleteError }}</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="askLeave"
    title="有修改还没保存"
    cancel-text="继续编辑"
    ok-text="不保存，离开"
    @cancel="askLeave = false"
    @ok="emit('back', changed)"
  >
    <p>现在离开，这些修改会丢掉。</p>
  </NoticeDialog>

  <NoticeDialog
    v-if="askClose"
    title="有修改还没保存"
    cancel-text="继续编辑"
    ok-text="关闭软件"
    @cancel="askClose = false"
    @ok="destroyWindow"
  >
    <p>关闭软件后，这些修改会丢掉。</p>
  </NoticeDialog>

  <p v-if="openError" class="open-error">{{ openError }}</p>
</template>

<style scoped>
.hint {
  padding: var(--sp-6);
  color: var(--muted);
  font-size: var(--fs-sm);
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
