// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import NoticeDialog from './NoticeDialog.vue'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { installContextMenu } from './contextMenu'
import { toast } from './useToast'
import { readClipboard, writeClipboard } from '../shell/tauri'
vi.mock('../shell/tauri', () => ({ readClipboard: vi.fn(), writeClipboard: vi.fn() }))
vi.mock('./useToast', () => ({ toast: vi.fn() }))
let off: (() => void) | undefined
let rich: Editor | undefined
let dialog: ReturnType<typeof createApp> | undefined
const writeText = vi.mocked(writeClipboard)
const readText = vi.mocked(readClipboard)
beforeEach(() => {
  vi.stubGlobal('navigator', {
    platform: 'Win32',
    userAgent: 'jsdom',
    get clipboard() {
      throw new Error('不能调用浏览器剪贴板')
    },
  })
  document.documentElement.style.setProperty('--sp-3', '8px')
  vi.stubGlobal('ClipboardEvent', class extends Event {})
  writeText.mockReset().mockResolvedValue(undefined)
  readText.mockReset().mockResolvedValue({ text: '粘贴内容' })
})
afterEach(() => {
  off?.()
  rich?.destroy()
  dialog?.unmount()
  dialog = undefined
  rich = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  document.documentElement.style.removeProperty('--sp-3')
})
async function settle() {
  for (let i = 0; i < 4; i++) await nextTick()
}
async function open(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
  await settle()
}
function command(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
    b.textContent?.trim().startsWith(label),
  )
  if (!button) throw new Error('没有菜单项：' + label)
  return button
}
function input() {
  const element = document.createElement('textarea')
  element.value = '前段文字后段'
  document.body.append(element)
  element.focus()
  element.setSelectionRange(2, 4)
  return element
}
it('正式版空白处不显示菜单，输入框显示四项且复制保持选区', async () => {
  off = installContextMenu(false)
  await open(document.body)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  const element = input()
  await open(element)
  expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.firstChild?.textContent?.trim())).toEqual([
    '剪切',
    '复制',
    '粘贴',
    '全选',
  ])
  command('复制').click()
  await settle()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('文字')
  expect(element.value).toBe('前段文字后段')
  expect(element.selectionStart).toBe(2)
  expect(element.selectionEnd).toBe(4)
})
it('开发模式保留WebView默认菜单', () => {
  off = installContextMenu(true)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('开发时显式开启菜单预览，无需打包也使用自定义编辑菜单', async () => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('VITE_PREVIEW_EDIT_MENU', '1')
  off = installContextMenu()
  await open(input())
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  command('复制').click()
  await settle()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('文字')
})

it('剪切失败不删文字，粘贴失败不改内容并提示', async () => {
  off = installContextMenu(false)
  const element = input()
  writeText.mockRejectedValueOnce(new Error('拒绝剪贴板'))
  await open(element)
  command('剪切').click()
  await settle()
  expect(element.value).toBe('前段文字后段')
  readText.mockRejectedValueOnce(new Error('拒绝剪贴板'))
  await open(element)
  command('粘贴').click()
  await settle()
  expect(element.value).toBe('前段文字后段')
  expect(toast).toHaveBeenCalledTimes(2)
})

it('粘贴等待中用户切换输入框，不修改原输入', async () => {
  off = installContextMenu(false)
  const element = input()
  let finish: ((value: { text: string }) => void) | undefined
  readText.mockReturnValueOnce(
    new Promise<{ text: string }>((resolve) => {
      finish = resolve
    }),
  )
  await open(element)
  command('粘贴').click()
  const other = document.createElement('input')
  document.body.append(other)
  other.focus()
  if (!finish) throw new Error('读取未开始')
  finish({ text: '迟到内容' })
  await settle()
  expect(element.value).toBe('前段文字后段')
  expect(other.value).toBe('')
})

it('只读禁用剪切粘贴，密码禁用复制，无选区禁用复制，Esc恢复焦点', async () => {
  off = installContextMenu(false)
  const element = input()
  element.readOnly = true
  await open(element)
  expect(command('剪切').disabled).toBe(true)
  expect(command('粘贴').disabled).toBe(true)
  expect(command('复制').disabled).toBe(false)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(document.activeElement).toBe(element)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  const password = document.createElement('input')
  password.type = 'password'
  password.value = '测试密码'
  document.body.append(password)
  password.setSelectionRange(0, 2)
  await open(password)
  expect(command('复制').disabled).toBe(true)
  element.readOnly = false
  element.setSelectionRange(0, 0)
  await open(element)
  expect(command('复制').disabled).toBe(true)
})

it('正文剪切和粘贴走Tiptap，撤销可恢复；全选只选编辑区', async () => {
  off = installContextMenu(false)
  const container = document.createElement('div')
  document.body.append(container)
  rich = new Editor({
    element: container,
    extensions: [StarterKit],
    content: '<p>正文内容</p>',
    editorProps: { handleScrollToSelection: () => true },
  })
  rich.commands.setTextSelection({ from: 1, to: 3 })
  await open(rich.view.dom)
  command('剪切').click()
  await settle()
  expect(writeText).toHaveBeenCalledWith('正文', expect.stringContaining('正文'))
  expect(rich.getText()).toBe('内容')
  expect(rich.commands.undo()).toBe(true)
  expect(rich.getText()).toBe('正文内容')
  rich.commands.setTextSelection({ from: 1, to: 3 })
  await open(rich.view.dom)
  command('粘贴').click()
  await settle()
  expect(rich.getText()).toBe('粘贴内容内容')
  await open(rich.view.dom)
  command('全选').click()
  await settle()
  expect(rich.state.selection.from).toBe(0)
  expect(rich.state.selection.to).toBe(rich.state.doc.content.size)
})

it('菜单在弹窗焦点边界内，方向键切项，Esc只关菜单，再次Esc才关闭弹窗', async () => {
  off = installContextMenu(false)
  const root = document.createElement('div')
  document.body.append(root)
  const cancel = vi.fn()
  dialog = createApp({
    render: () =>
      h(
        NoticeDialog,
        { title: '编辑', cancelText: '关闭', onCancel: cancel },
        { default: () => h('input', { value: '测试' }) },
      ),
  })
  dialog.mount(root)
  await settle()
  const element = root.querySelector('input')
  if (!element) throw new Error('缺少弹窗输入框')
  element.setSelectionRange(0, 2)
  await open(element)
  expect(root.querySelector('[role="alertdialog"] [role="menu"]')).not.toBeNull()
  expect(document.activeElement).toBe(command('剪切'))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  expect(document.activeElement).toBe(command('复制'))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(cancel).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(element)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('正文优先粘贴富文本，保留加粗', async () => {
  off = installContextMenu(false)
  const root = document.createElement('div')
  document.body.append(root)
  rich = new Editor({
    element: root,
    extensions: [StarterKit],
    content: '<p>旧内容</p>',
    editorProps: { handleScrollToSelection: () => true },
  })
  readText.mockResolvedValueOnce({ text: '加粗文字', html: '<p><strong>加粗</strong>文字</p>' })
  rich.commands.selectAll()
  await open(rich.view.dom)
  command('粘贴').click()
  await settle()
  expect(rich.getHTML()).toBe('<p><strong>加粗</strong>文字</p>')
  expect(readText).toHaveBeenCalledExactlyOnceWith(true)
})
