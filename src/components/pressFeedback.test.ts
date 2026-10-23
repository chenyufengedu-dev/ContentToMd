// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, withDirectives } from 'vue'
import { bindPressFeedback, vPress, type PressEffect } from './pressFeedback'

const animations: { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions }[] = []
let reduce = false
beforeEach(() => {
  animations.length = 0
  reduce = false
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }))
  // jsdom 没有 Web Animations API，记录动画请求以核对真实交互参数。
  Element.prototype.animate = vi.fn(function (this: Element, frames, options) {
    animations.push({ el: this, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions })
    return { cancel: vi.fn(), finished: new Promise(() => {}) } as unknown as Animation
  })
  document.documentElement.style.cssText =
    '--press-down:60;--press-release:190;--press-surface-down:40;--press-surface-release:140;--press-icon-release:150;--press-ripple-time:460;--press-scale:.985;--press-rebound:1.002;--press-icon-scale:.94;--press-ripple-opacity:.12;'
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, 'animate')
  vi.unstubAllGlobals()
})
function button(effect: PressEffect) {
  const el = document.createElement('button')
  el.innerHTML = '<svg></svg>保存'
  document.body.append(el)
  const dispose = bindPressFeedback(el, () => effect)
  return { el, dispose }
}
function down(el: Element, x = 0, y = 0) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }))
}
it('禁用按钮不产生反馈，也不接管原有点击', () => {
  const { el, dispose } = button('surface')
  el.disabled = true
  down(el)
  expect(animations).toHaveLength(0)
  expect(el.querySelector('.press-layer')).toBeNull()
  dispose()
})
it('按住超过进入动画时长仍保持按压，释放或卸载才清理', async () => {
  const cancels: ReturnType<typeof vi.fn>[] = []
  Element.prototype.animate = vi.fn(() => {
    const cancel = vi.fn()
    cancels.push(cancel)
    return { cancel, finished: Promise.resolve() } as unknown as Animation
  })
  const { el, dispose } = button('tactile')
  down(el)
  await Promise.resolve()
  expect(cancels[1]).not.toHaveBeenCalled()
  expect(el.querySelector('.press-surface')).not.toBeNull()
  window.dispatchEvent(new MouseEvent('pointerup'))
  expect(cancels[1]).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  expect(el.querySelector('.press-layer')).toBeNull()
  dispose()
})
it('主按钮按压和回位使用选定参数，点击业务同步执行', () => {
  const { el, dispose } = button('tactile')
  const click = vi.fn()
  el.addEventListener('click', click)
  down(el)
  expect(animations.find((a) => a.el === el)?.frames.at(-1)).toEqual({ scale: '.985' })
  expect(animations.find((a) => a.el === el)?.options.duration).toBe(60)
  window.dispatchEvent(new MouseEvent('pointerup'))
  el.click()
  expect(click).toHaveBeenCalledTimes(1)
  expect(animations.filter((a) => a.el === el).at(-1)?.frames).toEqual([
    { scale: '.985' },
    { scale: '1.002', offset: 0.7 },
    { scale: '1' },
  ])
  expect(animations.filter((a) => a.el === el).at(-1)?.options.duration).toBe(190)
  dispose()
})
it('图标反馈只缩放内部图标，不覆盖原有 transform', () => {
  const { el, dispose } = button('icon')
  const svg = el.querySelector('svg')!
  svg.style.transform = 'rotate(90deg)'
  down(el)
  expect(animations.find((a) => a.el === svg)?.frames.at(-1)).toEqual({ scale: '.94' })
  expect(animations.some((a) => a.el === el)).toBe(false)
  expect(svg.style.transform).toBe('rotate(90deg)')
  dispose()
})
it('扩散从点击点出发，外框不缩放，键盘从中心出发', () => {
  const { el, dispose } = button('ripple')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 40))
  down(el, 35, 32)
  const wave = el.querySelector<HTMLElement>('.press-wave')!
  expect(parseFloat(wave.style.left) + parseFloat(wave.style.width) / 2).toBeCloseTo(25)
  expect(parseFloat(wave.style.top) + parseFloat(wave.style.height) / 2).toBeCloseTo(12)
  expect(animations.some((a) => a.el === el)).toBe(false)
  window.dispatchEvent(new MouseEvent('pointerup'))
  el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
  const centered = el.querySelectorAll<HTMLElement>('.press-wave')[1]
  expect(parseFloat(centered.style.left) + parseFloat(centered.style.width) / 2).toBeCloseTo(50)
  dispose()
})
it.each<PressEffect>(['tactile', 'icon', 'ripple'])('减少动态效果时 %s 保留颜色层，取消缩放和扩散', (effect) => {
  reduce = true
  const { el, dispose } = button(effect)
  down(el)
  expect(el.querySelector('.press-wave')).toBeNull()
  expect(animations.every((a) => a.frames.every((f) => f.scale === undefined))).toBe(true)
  expect(el.querySelector('.press-layer')).not.toBeNull()
  expect(animations.some((a) => a.el === el)).toBe(false)
  dispose()
})
it('键盘释放、移出、取消与卸载都能结束按住状态', () => {
  const { el, dispose } = button('surface')
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
  expect(animations.at(-1)?.frames.at(-1)).toEqual({ opacity: 0 })
  down(el)
  el.dispatchEvent(new MouseEvent('pointerleave'))
  expect(animations.at(-1)?.frames.at(-1)).toEqual({ opacity: 0 })
  down(el)
  window.dispatchEvent(new Event('pointercancel'))
  expect(animations.at(-1)?.frames.at(-1)).toEqual({ opacity: 0 })
  dispose()
  expect(el.querySelector('.press-layer')).toBeNull()
  const count = animations.length
  down(el)
  expect(animations).toHaveLength(count)
})

it('Vue 更新反馈类型和卸载时清理旧动画、图层及窗口事件', async () => {
  const effect = ref<PressEffect>('tactile')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => withDirectives(h('button', '保存'), [[vPress, effect.value]]) })
  app.mount(root)
  const el = root.querySelector('button')
  if (!el) throw new Error('缺少测试按钮')
  down(el)
  const oldLayer = el.querySelector('.press-layer')
  effect.value = 'ripple'
  await nextTick()
  expect(oldLayer?.isConnected).toBe(false)
  down(el)
  expect(el.querySelector('.press-wave')).not.toBeNull()
  app.unmount()
  expect(el.querySelector('.press-layer')).toBeNull()
  expect(el.hasAttribute('data-press-feedback')).toBe(false)
  const count = animations.length
  window.dispatchEvent(new MouseEvent('pointerup'))
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
  down(el)
  expect(animations).toHaveLength(count)
})
