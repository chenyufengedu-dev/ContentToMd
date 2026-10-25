// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { vImportSize } from './importSize'
import { createApp, h, nextTick, ref, withDirectives } from 'vue'

const originalAnimate = HTMLElement.prototype.animate
const disposals: (() => void)[] = []
const animations: { cancel: ReturnType<typeof vi.fn>; finished: Promise<Animation> }[] = []
const animate = vi.fn(() => {
  const animation = { cancel: vi.fn(), finished: new Promise<Animation>(() => {}) }
  animations.push(animation)
  return animation
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: originalAnimate })
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  document.documentElement.removeAttribute('style')
  animations.length = 0
  animate.mockClear()
})
function fixture(reduced = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  document.documentElement.style.setProperty('--import-resize-duration', '200ms')
  document.documentElement.style.setProperty('--motion-ease-out', 'cubic-bezier(0.2, 0, 0, 1)')
  const height = ref(176)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => withDirectives(h('div', String(height.value)), [[vImportSize, String(height.value)]]),
  })
  app.mount(root)
  const el = root.querySelector('div')
  if (!el) throw new Error('缺少内容容器')
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => DOMRect.fromRect({ height: Number(el.textContent) }))
  disposals.push(() => app.unmount())
  return {
    async change(next: number) {
      height.value = next
      await nextTick()
    },
    dispose() {
      app.unmount()
    },
    el,
  }
}
it('从旧高度平顺收缩并反向展开，不留下固定高度', async () => {
  const view = fixture()
  await view.change(64)
  expect(animate).toHaveBeenLastCalledWith(
    [
      { height: '176px', overflow: 'clip' },
      { height: '64px', overflow: 'clip' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  )
  await view.change(176)
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(animate).toHaveBeenLastCalledWith(
    [
      { height: '64px', overflow: 'clip' },
      { height: '176px', overflow: 'clip' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  )
  expect(view.el.style.height).toBe('')
  view.dispose()
  expect(animations[1].cancel).toHaveBeenCalledOnce()
})
it('减少动态效果或高度不变时不播放', async () => {
  const view = fixture(true)
  await view.change(64)
  expect(animate).not.toHaveBeenCalled()
  view.dispose()
  const same = fixture()
  await same.change(176)
  expect(animate).not.toHaveBeenCalled()
})
