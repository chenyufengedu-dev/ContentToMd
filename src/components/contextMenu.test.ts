// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installContextMenu } from './contextMenu'
import { showEditMenu } from '../shell/tauri'
vi.mock('../shell/tauri', () => ({ showEditMenu: vi.fn().mockResolvedValue(undefined) }))
let off: (() => void) | undefined
afterEach(() => {
  off?.()
  document.body.replaceChildren()
  vi.clearAllMocks()
})
it('正式版屏蔽空白处菜单，仅文本编辑处显示编辑菜单', () => {
  off = installContextMenu(false)
  document.body.innerHTML =
    '<div id="blank"></div><input><textarea></textarea><div contenteditable="true"><p>正文</p></div><div contenteditable="false">只读</div>'
  for (const selector of ['#blank', 'input', 'textarea', '[contenteditable="true"] p', '[contenteditable="false"]']) {
    const element = document.querySelector(selector)
    if (!element) throw new Error('缺少测试元素')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  expect(showEditMenu).toHaveBeenCalledTimes(3)
})
it('开发模式保留WebView默认菜单', () => {
  off = installContextMenu(true)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(showEditMenu).not.toHaveBeenCalled()
})
