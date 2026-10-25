import type { Directive } from 'vue'

const states = new WeakMap<HTMLElement, { height: number; animation?: Animation }>()

/** 只过渡投放内容区，业务状态和焦点不等待动画。 */
export const vImportSize: Directive<HTMLElement, string> = {
  beforeUpdate(el, { value, oldValue }) {
    if (value === oldValue) return
    const height = el.getBoundingClientRect().height
    states.get(el)?.animation?.cancel()
    states.set(el, { height })
  },
  updated(el, { value, oldValue }) {
    if (value === oldValue) return
    const state = states.get(el)
    if (!state) return
    const height = el.getBoundingClientRect().height
    if (state.height === height || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      states.delete(el)
      return
    }
    const tokens = getComputedStyle(document.documentElement)
    const animation = el.animate(
      [
        { height: `${state.height}px`, overflow: 'clip' },
        { height: `${height}px`, overflow: 'clip' },
      ],
      {
        duration: parseFloat(tokens.getPropertyValue('--import-resize-duration')),
        easing: tokens.getPropertyValue('--motion-ease-out').trim(),
      },
    )
    state.animation = animation
    const clear = () => {
      if (states.get(el) === state) states.delete(el)
    }
    void animation.finished.then(clear, clear)
  },
  beforeUnmount(el) {
    states.get(el)?.animation?.cancel()
    states.delete(el)
  },
}
