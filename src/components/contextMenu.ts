import { createApp, h, nextTick, shallowRef } from 'vue'
import EditContextMenu from './EditContextMenu.vue'
import { captureEditTarget } from './editTarget'
import { toast } from './useToast'
import { readClipboard, writeClipboard } from '../shell/tauri'

/** 正式版只提供文本编辑菜单，不暴露浏览器导航和文件操作。 */
export function installContextMenu(
  development = import.meta.env.DEV && import.meta.env.VITE_PREVIEW_EDIT_MENU !== '1',
) {
  if (development) return () => {}
  const host = document.createElement('div')
  const state = shallowRef<{ target: ReturnType<typeof captureEditTarget>; x: number; y: number } | null>(null)
  let generation = 0
  function close(restore = false) {
    if (restore && state.value?.target.element.isConnected) state.value.target.restore()
    state.value = null
    generation++
  }
  async function action(command: string) {
    const current = state.value
    if (!current) return
    const target = current.target
    if ((command === 'cut' || command === 'copy') && (!target.selected || target.password)) return
    if ((command === 'cut' || command === 'paste') && !target.writable) return
    target.restore()
    const valid = target.unchanged()
    state.value = null
    const ticket = ++generation
    try {
      if (command === 'selectAll') target.selectAll()
      else if (command === 'copy' || command === 'cut') {
        if (target.html) await writeClipboard(target.text, target.html)
        else await writeClipboard(target.text)
        if (command === 'cut' && ticket === generation && valid()) target.replace('')
      } else if (command === 'paste') {
        const { text, html } = await readClipboard(target.html !== undefined)
        if ((text || html) && ticket === generation && valid()) target.replace(text, html)
      }
    } catch {
      if (ticket === generation) toast('编辑操作失败，请使用键盘快捷键重试。', { kind: 'error' })
    }
  }
  const app = createApp({
    render: () =>
      state.value
        ? h(EditContextMenu, {
            x: state.value.x,
            y: state.value.y,
            selected: state.value.target.selected,
            writable: state.value.target.writable,
            password: state.value.target.password,
            onAction: action,
          })
        : null,
  })
  app.mount(host)
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const onContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    close()
    const target = event.target instanceof Element ? event.target : null
    const editor = target?.closest<HTMLElement>('input, textarea, [contenteditable]')
    if (!editor) return
    if (
      editor instanceof HTMLInputElement &&
      !['text', 'password', 'search', 'email', 'url', 'tel', 'number'].includes(editor.type)
    )
      return
    if (
      editor.matches(':disabled') ||
      (editor.hasAttribute('contenteditable') && editor.getAttribute('contenteditable') === 'false')
    )
      return
    editor.focus({ preventScroll: true })
    ;(editor.closest('[role="dialog"], [role="alertdialog"]') ?? document.body).append(host)
    const rect = editor.getBoundingClientRect()
    const current = {
      target: captureEditTarget(editor),
      x: event.clientX || rect.left,
      y: event.clientY || rect.bottom,
    }
    state.value = current
    await nextTick()
    if (state.value !== current) return
    const menu = host.querySelector<HTMLElement>('[role="menu"]')
    if (!menu) return
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-3'))
    state.value = {
      ...current,
      x: Math.max(gap, Math.min(current.x, innerWidth - menu.offsetWidth - gap)),
      y: Math.max(gap, Math.min(current.y, innerHeight - menu.offsetHeight - gap)),
    }
    buttons()[0]?.focus({ preventScroll: true })
  }
  function onPointer(event: PointerEvent) {
    if (!(event.target instanceof Node) || !host.contains(event.target)) close()
  }
  function onKey(event: KeyboardEvent) {
    if (!state.value) return
    if (!state.value.target.element.isConnected) {
      close()
      return
    }
    event.stopPropagation()
    const items = buttons()
    const index = items.findIndex((item) => item === document.activeElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      close(true)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
      items[next]?.focus()
    } else if ((event.ctrlKey || event.metaKey) && ['x', 'c', 'v', 'a'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      const commands: Record<string, string> = { x: 'cut', c: 'copy', v: 'paste', a: 'selectAll' }
      void action(commands[event.key.toLowerCase()])
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      items[index]?.click()
    } else {
      event.preventDefault()
    }
  }
  const onDismiss = () => close()
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('pointerdown', onPointer, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('scroll', onDismiss, true)
  window.addEventListener('resize', onDismiss)
  window.addEventListener('blur', onDismiss)
  return () => {
    close()
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('pointerdown', onPointer, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('scroll', onDismiss, true)
    window.removeEventListener('resize', onDismiss)
    window.removeEventListener('blur', onDismiss)
    app.unmount()
    host.remove()
  }
}
