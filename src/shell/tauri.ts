// 外壳接口：配置读写、选文件夹、网络请求。界面和核心只通过这里接触 Tauri

import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { Config } from '../core/config'
import type { Fetch } from '../core/services'
import type { Job } from '../core/pipeline'
import { DRAFT_JSON, toDraft, type DraftData } from '../core/draft'
import { parseUsage, type UsageRecord } from '../core/cost'
import { parseNoteList } from '../core/library'
import { parseNoteFile } from '../core/note'
import { NoteRecoverySchema, type NoteRecovery } from '../core/noteRecovery'

// 同一窗口的写入、清除和读取按调用顺序完成，旧写入不会在清除之后重新出现。
let recoveryWrites: Promise<unknown> = Promise.resolve()
function updateRecovery(root: string, path: string, json: string | null) {
  const next = recoveryWrites.then(() => invoke<void>('edit_recovery_write', { root, path, json }))
  recoveryWrites = next.catch(() => {}) // 错误仍由本次调用者提示，后续保存可以重试。
  return next
}
export async function listEditRecoveries(): Promise<NoteRecovery[]> {
  await recoveryWrites
  return (await invoke<string[]>('edit_recovery_list')).map((text) => NoteRecoverySchema.parse(JSON.parse(text)))
}
export const saveEditRecovery = (recovery: NoteRecovery) =>
  updateRecovery(recovery.root, recovery.path, JSON.stringify(recovery))
export const clearEditRecovery = (root: string, path: string) => updateRecovery(root, path, null)

export const loadConfigJson = () => invoke<string | null>('load_config')
export const saveConfig = (c: Config) => invoke<void>('save_config', { json: JSON.stringify(c, null, 2) })
export const dirExists = (path: string) => invoke<boolean>('dir_exists', { path })
export const folderHasNotes = (path: string) => invoke<boolean>('folder_has_notes', { path })

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const r = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultPath || undefined,
    title: '选择收藏库文件夹',
  })
  return typeof r === 'string' ? r : null
}

/**
 * 先用 WebView 自己的 fetch（快，音频不用经过进程间通信）；
 * 服务商不允许跨域时浏览器会抛 TypeError，这时改由 Tauri 发请求，绕开跨域限制（方案第 12.1 节）
 */
export const httpFetch: Fetch = async (url, init) => {
  try {
    return await window.fetch(url, init)
  } catch (e) {
    if (init?.signal?.aborted || !(e instanceof TypeError)) throw e
    return tauriFetch(url, init)
  }
}

export const ensurePrompts = (defaults: Record<string, string>) =>
  invoke<Record<string, string>>('ensure_prompts', { defaults })
export const listVaultTags = (vault: string) => invoke<string[]>('list_vault_tags', { vault })
export const openNote = (vault: string, relPath: string, inObsidian: boolean) =>
  invoke<void>('open_note', { vault, relPath, inObsidian })
/** 用系统浏览器打开网页（外壳只放行 https 地址） */
export const openLink = (url: string) => invoke<void>('open_link', { url })
/** 软件版本号，以 tauri.conf.json 为准 */
export const appVersion = () => getVersion()
export const listObsidianVaults = () => invoke<{ name: string; path: string }[]>('list_obsidian_vaults')
// 收藏库页（F21）
export const listNotes = async (root: string) => parseNoteList(await invoke<unknown>('list_notes', { root }))
export const readCover = async (root: string, relPath: string) =>
  new Blob([await invoke<ArrayBuffer>('read_cover', { root, relPath })])
// 笔记查看和编辑（F22）：保存时领域或文件名变了，外壳会把文件挪过去；删除放进回收站，返回一起删掉的图片数
export const readNote = async (root: string, relPath: string) =>
  parseNoteFile(await invoke<unknown>('read_note', { root, relPath }))
export const saveNote = (
  root: string,
  relPath: string,
  domain: string,
  stem: string,
  content: string,
  expected: string,
) => invoke<string>('save_note', { root, relPath, domain, stem, content, expected })
/** 返回一起放进回收站的图片（相对存放文件夹），撤销时要把它们一起交回来 */
export const deleteNote = (root: string, relPath: string) => invoke<string[]>('delete_note', { root, relPath })
/** 撤销删除：把刚放进回收站的笔记和图片还原到原位置 */
export const restoreNote = (root: string, relPath: string, images: string[]) =>
  invoke<void>('restore_note', { root, relPath, images })
// 删除领域：文件夹和里面的笔记整个放进回收站（作者定：删领域就是彻底删文件夹，先问清楚有多少篇笔记）
export const countDomainNotes = (root: string, domain: string) => invoke<number>('count_domain_notes', { root, domain })
export const deleteDomain = (root: string, domain: string) =>
  invoke<{ notes: number; images: string[]; existed: boolean }>('delete_domain', { root, domain })
export const restoreDomain = (root: string, domain: string, images: string[]) =>
  invoke<void>('restore_domain', { root, domain, images })
export const listSubfolders = (vault: string) => invoke<string[]>('list_subfolders', { vault })
export const ensureSubfolder = (vault: string, sub: string) => invoke<void>('ensure_subfolder', { vault, sub })
export const writeNote = (vault: string, domain: string, title: string, date: string, content: string) =>
  invoke<string>('write_note', { vault, domain, title, date, content })
/** 图片写进 收藏库/附件/年-月/；图片内容直接放在请求体里，参数放请求头（见 main.rs 的 write_attachment） */
export const writeAttachment = async (vault: string, month: string, name: string, data: Blob) =>
  invoke<string>('write_attachment', new Uint8Array(await data.arrayBuffer()), {
    headers: { vault: encodeURIComponent(vault), month: encodeURIComponent(month), name: encodeURIComponent(name) },
  })
export const removeAttachment = (vault: string, relPath: string) =>
  invoke<void>('remove_attachment', { vault, relPath })

// 草稿（F10）：draft.json 和图片原文件，见 core/draft.ts
const putDraftFile = async (name: string, data: Blob) =>
  invoke<void>('draft_write', new Uint8Array(await data.arrayBuffer()), {
    headers: { name: encodeURIComponent(name) },
  })
/** withFiles：连图片原文件一起存（只在任务刚开始时存一次，之后只更新 draft.json） */
export async function saveDraft(job: Job, withFiles = false): Promise<void> {
  const { data, files } = toDraft(job)
  if (withFiles) for (const f of files) await putDraftFile(f.name, f.blob)
  await putDraftFile(DRAFT_JSON, new Blob([JSON.stringify(data)]))
}
/** 没有草稿时返回 null */
export async function loadDraft(): Promise<{ data: DraftData; files: Record<string, Blob> } | null> {
  const names = await invoke<string[]>('draft_list')
  if (!names.includes(DRAFT_JSON)) return null
  const read = async (name: string) => new Blob([await invoke<ArrayBuffer>('draft_read', { name })])
  const data = JSON.parse(await (await read(DRAFT_JSON)).text()) as DraftData
  const files: Record<string, Blob> = {}
  for (const n of names.filter((n) => n !== DRAFT_JSON)) files[n] = await read(n)
  return { data, files }
}
export const clearDraft = () => invoke<void>('draft_clear')

// 费用记录（F14）：usage.jsonl，一次调用一行
export const appendUsage = (r: UsageRecord) => invoke<void>('usage_append', { line: JSON.stringify(r) })
export const readUsage = async () => parseUsage(await invoke<string>('usage_read'))

// 自绘标题栏用的窗口操作（窗口没有系统标题栏，见 tauri.conf.json 的 decorations）
export const minimizeWindow = () => getCurrentWindow().minimize()
export const toggleMaximizeWindow = () => getCurrentWindow().toggleMaximize()
export const closeWindow = () => getCurrentWindow().close()
/**
 * 关窗口前问一句（F10、F22）：shouldAsk 返回 true 时拦下关闭，交给 ask 弹确认框。返回取消登记的函数。
 * 只向窗口注册一个监听：Tauri 里每个监听在自己没拦下时都会直接关掉窗口，多个页面各注册一个的话，
 * 前面一个说“不用问”就把后面要问的盖掉了
 */
const closeGuards = new Set<{ shouldAsk: () => boolean; ask: () => void }>()
let closeListener: Promise<unknown> | undefined
export const guardClose = async (shouldAsk: () => boolean, ask: () => void) => {
  const guard = { shouldAsk, ask }
  closeGuards.add(guard)
  closeListener ??= getCurrentWindow().onCloseRequested((e) => {
    const hit = [...closeGuards].find((g) => g.shouldAsk())
    if (!hit) return
    e.preventDefault()
    hit.ask()
  })
  await closeListener
  return () => void closeGuards.delete(guard)
}
/** 确认后真正关闭，不再触发上面的询问 */
export const destroyWindow = () => invoke<void>('destroy_window')
