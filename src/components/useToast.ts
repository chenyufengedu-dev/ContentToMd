// 顶部居中的小提示条：做完一个操作（保存、删除、新增……）告诉用户结果，过一会儿自己消失，不弹窗（作者定的原则）。
// 可以带一个按钮（比如“撤销”），带按钮的多留一会儿
import { ref } from 'vue'

export const TOAST_MS = 2600
/** 带按钮的提示留多久（给用户时间点按钮） */
export const TOAST_ACTION_MS = 7000

export interface ToastAction {
  label: string
  run: () => void
}

export const current = ref<{ text: string; id: number; action?: ToastAction; kind: 'ok' | 'error' } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

/** 显示一条提示（句子带句号）；接连来的后一条顶替前一条并重新计时 */
export function toast(text: string, opts: { action?: ToastAction; kind?: 'ok' | 'error' } = {}) {
  clearTimeout(timer)
  current.value = { text, id: ++seq, action: opts.action, kind: opts.kind ?? 'ok' }
  timer = setTimeout(() => (current.value = null), opts.action ? TOAST_ACTION_MS : TOAST_MS)
}

/** 马上收起提示 */
export function dismiss() {
  clearTimeout(timer)
  current.value = null
}
