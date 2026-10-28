import { showEditMenu } from '../shell/tauri'
import { toast } from './useToast'

/** 正式版只提供文本编辑菜单，不暴露浏览器导航和文件操作。 */
export function installContextMenu(development = import.meta.env.DEV) {
  if (development) return () => {}
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
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
    void showEditMenu().catch(() => toast('编辑菜单打开失败，请使用键盘快捷键。', { kind: 'error' }))
  }
  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}
