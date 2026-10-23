import { onBeforeUnmount, onMounted, type Ref } from 'vue'

// 多个提示并存时，只允许最上层接收键盘和焦点。
const dialogs: HTMLElement[] = []
export function useModal(root: Ref<HTMLElement | undefined>, dismiss: () => void) {
  let opener: Element | null = null
  const isTop = () => dialogs.at(-1) === root.value
  const controls = () =>
    [
      ...(root.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
      ) ?? []),
    ].filter(
      (el) =>
        !el.closest('[hidden], [inert]') &&
        getComputedStyle(el).display !== 'none' &&
        getComputedStyle(el).visibility !== 'hidden',
    )
  const focusFirst = () => (controls()[0] ?? root.value)?.focus()
  function onFocus(e: FocusEvent) {
    if (isTop() && e.target instanceof Node && !root.value?.contains(e.target)) focusFirst()
  }
  function onKey(e: KeyboardEvent) {
    if (!isTop()) return
    // 在目标控件处理后截住冒泡，保留输入行为，同时隔离页面的 window 快捷键。
    e.stopPropagation()
    if (e.ctrlKey && (e.key.toLowerCase() === 's' || e.key === 'Enter')) e.preventDefault()
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const items = controls()
      const at = items.findIndex((el) => el === document.activeElement)
      const next =
        at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? items.length - 1 : 1)) % items.length
      ;(items[next] ?? root.value)?.focus()
    }
  }
  const stopPaste = (e: ClipboardEvent) => {
    if (isTop()) e.stopPropagation()
  }
  onMounted(() => {
    if (!root.value) return
    opener = document.activeElement
    dialogs.push(root.value)
    document.addEventListener('keydown', onKey)
    document.addEventListener('paste', stopPaste)
    document.addEventListener('focusin', onFocus)
    focusFirst()
  })
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('paste', stopPaste)
    document.removeEventListener('focusin', onFocus)
    const at = root.value ? dialogs.indexOf(root.value) : -1
    if (at < 0) return
    const wasTop = isTop()
    dialogs.splice(at, 1)
    if (wasTop && opener instanceof HTMLElement && opener.isConnected) opener.focus()
  })
}
