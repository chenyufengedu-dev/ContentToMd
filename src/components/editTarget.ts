import type { Editor } from '@tiptap/core'

/** 保存打开菜单时的编辑位置；Tiptap 公开的 DOM.editor 指向其编辑器实例。 */
export function captureEditTarget(element: HTMLElement) {
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
  const rich = (element as HTMLElement & { editor?: Editor }).editor
  const selection = window.getSelection()
  const range =
    !input && selection?.rangeCount && element.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null
  const start = input?.selectionStart ?? 0
  const end = input?.selectionEnd ?? start
  const from = rich?.state.selection.from ?? 0
  const to = rich?.state.selection.to ?? from
  const serialized = rich?.view.serializeForClipboard(rich.state.selection.content())
  const text = input ? input.value.slice(start, end) : rich ? (serialized?.text ?? '') : (range?.toString() ?? '')
  const writable = input ? !input.readOnly : element.getAttribute('contenteditable') !== 'false'
  const password = input instanceof HTMLInputElement && input.type === 'password'
  function restore() {
    element.focus({ preventScroll: true })
    if (input && input.selectionStart !== null) input.setSelectionRange(start, end)
    else if (rich) rich.commands.setTextSelection({ from, to })
    else if (range && selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }
  function replace(value: string, html?: string) {
    if (input) {
      // 使用浏览器编辑命令，保留输入事件和 Ctrl+Z 撤销记录。
      if (!document.execCommand(value ? 'insertText' : 'delete', false, value)) throw new Error('无法编辑输入框')
    } else if (rich) {
      if (html) rich.view.pasteHTML(html)
      else if (value) rich.view.pasteText(value)
      else rich.commands.deleteSelection()
    } else {
      // 原生编辑命令保留普通 contenteditable 的撤销栈和 input 通知。
      if (!document.execCommand(value ? 'insertText' : 'delete', false, value)) throw new Error('无法编辑正文')
    }
  }
  function unchanged() {
    const value = input?.value
    const doc = rich?.state.doc
    const richSelection = rich?.state.selection
    const html = element.innerHTML
    return () =>
      element.isConnected &&
      document.activeElement === element &&
      (input
        ? input.value === value && input.selectionStart === start && input.selectionEnd === end
        : rich
          ? rich.state.doc === doc && !!richSelection && rich.state.selection.eq(richSelection)
          : element.innerHTML === html && window.getSelection()?.toString() === text)
  }
  function selectAll() {
    element.focus({ preventScroll: true })
    if (input) input.select()
    else if (rich) rich.commands.selectAll()
    else {
      const all = document.createRange()
      all.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(all)
    }
  }
  return {
    element,
    selected: !!text,
    writable,
    password,
    text,
    html: serialized?.dom.innerHTML,
    restore,
    replace,
    unchanged,
    selectAll,
  }
}
