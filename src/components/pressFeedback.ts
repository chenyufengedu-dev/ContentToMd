import type { Directive } from 'vue'
import './pressFeedback.css'

export type PressEffect = 'tactile' | 'surface' | 'icon' | 'ripple'

/** 只监听输入来画反馈，不接管 click、默认行为或业务执行时机。 */
export function bindPressFeedback(el: HTMLElement, effect: () => PressEffect) {
  const tokens = getComputedStyle(document.documentElement)
  const value = (name: string) => tokens.getPropertyValue(`--press-${name}`).trim()
  const time = (name: string) => parseFloat(value(name))
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const layers = new Set<HTMLElement>()
  const animations = new Set<Animation>()
  let held = false
  let surface: HTMLElement | undefined
  let moving: Element | undefined
  let movement: Animation | undefined
  let shading: Animation | undefined
  // 低优先级的定位不覆盖关闭按钮等控件原有的 absolute 定位，也不被 Vue 的 class 更新冲掉。
  el.setAttribute('data-press-feedback', '')

  function animate(target: Element, frames: Keyframe[], duration: number, done?: () => void) {
    const animation = target.animate(frames, { duration, easing: 'ease-out', fill: 'forwards' })
    animations.add(animation)
    void animation.finished.then(
      () => {
        animations.delete(animation)
        if (done) {
          done()
          animation.cancel()
        }
      },
      () => animations.delete(animation), // 被新一次按压或卸载取消属于正常情况。
    )
    return animation
  }
  function layer() {
    const node = document.createElement('span')
    node.className = 'press-layer'
    node.setAttribute('aria-hidden', 'true')
    el.append(node)
    layers.add(node)
    return node
  }
  function remove(node: HTMLElement) {
    node.remove()
    layers.delete(node)
  }
  function release() {
    if (!held) return
    held = false
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
    window.removeEventListener('keyup', keyup, true)
    window.removeEventListener('blur', release)
    if (surface) {
      const node = surface
      const opacity = getComputedStyle(node).opacity
      shading?.cancel()
      shading = animate(node, [{ opacity }, { opacity: 0 }], time('surface-release'), () => {
        remove(node)
        if (surface === node) surface = undefined
      })
    }
    movement?.cancel()
    if (moving && !reduced()) {
      const target = moving
      const tactile = effect() === 'tactile'
      movement = animate(
        target,
        tactile
          ? [{ scale: value('scale') }, { scale: value('rebound'), offset: 0.7 }, { scale: '1' }]
          : [{ scale: value('icon-scale') }, { scale: '1' }],
        time(tactile ? 'release' : 'icon-release'),
      )
    }
  }
  function press(x?: number, y?: number) {
    if (held || el.matches(':disabled, [aria-disabled="true"]')) return
    held = true
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', release)
    const kind = effect()
    if (kind === 'ripple' && !reduced()) {
      const node = layer()
      const r = el.getBoundingClientRect()
      const size = 2 * Math.hypot(r.width, r.height)
      const wave = document.createElement('span')
      wave.className = 'press-wave'
      Object.assign(wave.style, {
        width: `${size}px`,
        height: `${size}px`,
        left: `${(x === undefined ? r.width / 2 : x - r.left) - size / 2}px`,
        top: `${(y === undefined ? r.height / 2 : y - r.top) - size / 2}px`,
      })
      node.append(wave)
      animate(
        wave,
        [
          { transform: 'scale(0)', opacity: value('ripple-opacity') },
          { transform: 'scale(0.65)', opacity: time('ripple-opacity') * 0.6, offset: 0.65 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        time('ripple-time'),
        () => remove(node),
      )
      return
    }
    const opacity = surface ? getComputedStyle(surface).opacity : '0'
    shading?.cancel()
    surface ??= layer()
    surface.classList.add('press-surface')
    shading = animate(surface, [{ opacity }, { opacity: 1 }], time('surface-down'))
    moving =
      kind === 'tactile'
        ? el
        : kind === 'icon'
          ? (el.querySelector(':scope > svg, :scope > .press-content') ?? undefined)
          : undefined
    if (!moving || reduced()) return
    const scale = getComputedStyle(moving).scale || '1'
    movement?.cancel()
    movement = animate(moving, [{ scale }, { scale: value(kind === 'tactile' ? 'scale' : 'icon-scale') }], time('down'))
  }
  function pointerdown(e: PointerEvent) {
    if (e.button === 0) press(e.clientX, e.clientY)
  }
  function keydown(e: KeyboardEvent) {
    if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) press()
  }
  function keyup(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') release()
  }
  el.addEventListener('pointerdown', pointerdown)
  el.addEventListener('pointerleave', release)
  el.addEventListener('keydown', keydown)
  el.addEventListener('blur', release)
  return () => {
    release()
    el.removeEventListener('pointerdown', pointerdown)
    el.removeEventListener('pointerleave', release)
    el.removeEventListener('keydown', keydown)
    el.removeEventListener('blur', release)
    for (const animation of animations) animation.cancel()
    movement?.cancel()
    shading?.cancel()
    for (const node of layers) node.remove()
    el.removeAttribute('data-press-feedback')
  }
}

const bindings = new WeakMap<HTMLElement, () => void>()
export const vPress: Directive<HTMLElement, PressEffect | undefined> = {
  mounted(el, binding) {
    bindings.set(
      el,
      bindPressFeedback(el, () => binding.value ?? 'surface'),
    )
  },
  updated(el, binding) {
    if (binding.value === binding.oldValue) return
    bindings.get(el)?.()
    bindings.set(
      el,
      bindPressFeedback(el, () => binding.value ?? 'surface'),
    )
  },
  beforeUnmount(el) {
    bindings.get(el)?.()
    bindings.delete(el)
  },
}
