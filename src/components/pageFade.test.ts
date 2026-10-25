// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, withDirectives, type App } from 'vue'
import { vPageFade } from './pageFade'

const originalAnimate = HTMLElement.prototype.animate
let app: App | undefined
const animations: { cancel: ReturnType<typeof vi.fn> }[] = []
const animate = vi.fn(() => {
  const animation = { cancel: vi.fn(), finished: new Promise<Animation>(() => {}) }
  animations.push(animation)
  return animation
})
beforeEach(() => {
  animations.length = 0
  animate.mockClear()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  document.documentElement.style.setProperty('--page-fade-duration', '200ms')
  document.documentElement.style.setProperty('--motion-ease-out', 'cubic-bezier(0.2, 0, 0, 1)')
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: originalAnimate })
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function mount() {
  const page = ref('home')
  const message = ref('输入内容保留')
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () =>
      withDirectives(h('div', [h('input', { value: message.value }), page.value]), [[vPageFade, page.value]]),
  })
  app.mount(root)
  return { page, message, root, app }
}
it('状态立即切换，只对新内容播放200ms透明度过渡，普通输入不重播', async () => {
  const view = mount()
  expect(animate).not.toHaveBeenCalled()
  const input = view.root.querySelector('input')
  view.page.value = 'library'
  await nextTick()
  expect(view.root.textContent).toContain('library')
  expect(view.root.querySelector('input')).toBe(input)
  expect(animate).toHaveBeenCalledExactlyOnceWith([{ opacity: 0 }, { opacity: 1 }], {
    duration: 200,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  })
  view.message.value = '继续输入'
  await nextTick()
  expect(animate).toHaveBeenCalledTimes(1)
})
it('快速切换取消旧动画，不排队，卸载后取消当前动画', async () => {
  const view = mount()
  view.page.value = 'library'
  await nextTick()
  view.page.value = 'settings'
  await nextTick()
  expect(animations[0].cancel).toHaveBeenCalledTimes(1)
  expect(view.root.textContent).toContain('settings')
  view.app.unmount()
  app = undefined
  expect(animations[1].cancel).toHaveBeenCalledTimes(1)
})
it('减少动态效果时直接切换，并停止上一轮过渡', async () => {
  const view = mount()
  view.page.value = 'library'
  await nextTick()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  view.page.value = 'settings'
  await nextTick()
  expect(view.root.textContent).toContain('settings')
  expect(animate).toHaveBeenCalledTimes(1)
  expect(animations[0].cancel).toHaveBeenCalledTimes(1)
})
