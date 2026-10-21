// 外壳接口：配置读写、选文件夹、网络请求。界面和核心只通过这里接触 Tauri

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { Config } from '../core/config'
import type { Fetch } from '../core/services'
import type { Job } from '../core/pipeline'
import { DRAFT_JSON, toDraft, type DraftData } from '../core/draft'

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
export const openNote = (vault: string, relPath: string) => invoke<void>('open_note', { vault, relPath })
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

// 自绘标题栏用的窗口操作（窗口没有系统标题栏，见 tauri.conf.json 的 decorations）
export const minimizeWindow = () => getCurrentWindow().minimize()
export const toggleMaximizeWindow = () => getCurrentWindow().toggleMaximize()
export const closeWindow = () => getCurrentWindow().close()
/** 关窗口前问一句（F10）：shouldAsk 返回 true 时拦下关闭，交给 ask 弹确认框。返回取消监听的函数 */
export const guardClose = (shouldAsk: () => boolean, ask: () => void) =>
  getCurrentWindow().onCloseRequested((e) => {
    if (!shouldAsk()) return
    e.preventDefault()
    ask()
  })
/** 确认后真正关闭，不再触发上面的询问 */
export const destroyWindow = () => getCurrentWindow().destroy()
