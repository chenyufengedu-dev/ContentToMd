// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import AboutCard from './AboutCard.vue'
import { TIMELINE } from './aboutWriting'

vi.mock('../shell/tauri', () => ({
  appVersion: vi.fn().mockResolvedValue('0.0.1'),
  openLink: vi.fn(),
}))
vi.mock('./useToast', () => ({ toast: vi.fn() }))

interface TestAnimation {
  cancel: ReturnType<typeof vi.fn>
  onfinish: (() => void) | null
}
const animations: TestAnimation[] = []
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
let app: App | undefined
let clock: MockInstance<() => number> | undefined
beforeEach(() => {
  animations.length = 0
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const animation: TestAnimation = { cancel: vi.fn(), onfinish: null }
      animations.push(animation)
      return animation
    }),
  })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  clock?.mockRestore()
  clock = undefined
  vi.unstubAllGlobals()
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})
async function settle() {
  for (let i = 0; i < 4; i++) await nextTick()
}
async function mount(initialOpen: boolean) {
  const open = ref(initialOpen)
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({ render: () => h(AboutCard, { open: open.value }) })
  app.mount(root)
  await settle()
  return { root, open }
}
it('键盘进入收起态博客后展开，焦点仍在同一个博客入口', async () => {
  const { root, open } = await mount(false)
  const briefLink = root.querySelector<HTMLAnchorElement>('.brief a')
  if (!briefLink) throw new Error('缺少收起态博客')
  briefLink.focus()
  expect(document.activeElement).toBe(briefLink)
  open.value = true // 模拟SettingCard收到键盘focusin后展开。
  await settle()
  const fullLink = root.querySelector<HTMLAnchorElement>('.full .links a')
  expect(document.activeElement).toBe(fullLink)
  expect(fullLink?.closest<HTMLElement>('[data-fade]')?.style.opacity).toBe('1')
})
it('致谢收起途中再次点击立即反向展开，旧回调不能覆盖新状态', async () => {
  const { root } = await mount(true)
  const button = root.querySelector<HTMLButtonElement>('.credits-btn')
  if (!button) throw new Error('缺少开源致谢按钮')
  button.click()
  await settle()
  expect(button.getAttribute('aria-expanded')).toBe('true')
  button.click()
  await settle()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(root.querySelector('.credits')?.hasAttribute('inert')).toBe(true)
  const closing = animations.at(-1)
  if (!closing) throw new Error('没有收起动画')
  const staleFinish = closing.onfinish
  button.click()
  await settle()
  expect(closing.cancel).toHaveBeenCalled()
  staleFinish?.()
  await settle()
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(root.querySelector('.credits')).not.toBeNull()
  expect(root.querySelector('.credits')?.hasAttribute('inert')).toBe(false)
})

it('M收笔前后保留同一遮罩，完成后不再切换笔画的渲染方式', async () => {
  let frame: FrameRequestCallback | undefined
  clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }),
  )
  const { root } = await mount(true)
  const m = root.querySelector('[data-about="m"]')
  const polygon = root.querySelector('[data-about="ink-poly"]')
  if (!m || !polygon || !frame) throw new Error('缺少M的绘制节点或播放回调')
  frame(TIMELINE.mEnd - 1)
  const mask = m.getAttribute('mask')
  expect(mask).toBe('url(#about-ink)')
  frame(TIMELINE.mEnd)
  expect(m.getAttribute('mask')).toBe(mask)
  const completedInk = polygon.getAttribute('points')
  expect(completedInk).toBeTruthy()
  frame(TIMELINE.total)
  expect(m.getAttribute('mask')).toBe(mask)
  expect(polygon.getAttribute('points')).toBe(completedInk)
})
