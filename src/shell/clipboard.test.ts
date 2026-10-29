import { afterEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { readClipboard, writeClipboard } from './tauri'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => vi.clearAllMocks())

it('剪贴板读取走原生命令，正文可请求HTML，输入框只请求文字', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ text: '原文', html: '<b>原文</b>' })
  expect(await readClipboard(true)).toEqual({ text: '原文', html: '<b>原文</b>' })
  expect(invoke).toHaveBeenLastCalledWith('read_clipboard', { includeHtml: true })
  await readClipboard()
  expect(invoke).toHaveBeenLastCalledWith('read_clipboard', { includeHtml: false })
})

it('复制文字及正文格式走同一个原生入口', async () => {
  await writeClipboard('文字')
  expect(invoke).toHaveBeenLastCalledWith('write_clipboard', { text: '文字', html: null })
  await writeClipboard('加粗', '<b>加粗</b>')
  expect(invoke).toHaveBeenLastCalledWith('write_clipboard', { text: '加粗', html: '<b>加粗</b>' })
})
