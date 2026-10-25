import type { Directive } from 'vue'

const running = new WeakMap<HTMLElement, Animation>()
function cancel(el: HTMLElement) {
  running.get(el)?.cancel()
  running.delete(el)
}

/** 只在页面状态变化后淡入新内容，不等待动画，不重新挂载页面。 */
export const vPageFade: Directive<HTMLElement, string> = {
  updated(el, { value, oldValue }) {
    if (value === oldValue) return
    cancel(el)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const tokens = getComputedStyle(document.documentElement)
    const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: parseFloat(tokens.getPropertyValue('--page-fade-duration')),
      easing: tokens.getPropertyValue('--motion-ease-out').trim(),
    })
    running.set(el, animation)
    const clear = () => {
      if (running.get(el) === animation) running.delete(el)
    }
    void animation.finished.then(clear, clear)
  },
  beforeUnmount: cancel,
}
