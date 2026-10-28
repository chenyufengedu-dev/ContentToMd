// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type * as ProjectInfo from '../core/projectInfo'
import { createApp, h, nextTick, ref, type App } from 'vue'
import AboutCard from './AboutCard.vue'
import { TIMELINE } from './aboutWriting'
import { FEEDBACK_EMAIL, GITHUB_URL } from '../core/projectInfo'
import { openLink } from '../shell/tauri'
import { toast } from './useToast'

const project = vi.hoisted(() => ({ repoPublic: false }))
vi.mock('../core/projectInfo', async (original) => ({
  ...(await original<typeof ProjectInfo>()),
  get REPO_PUBLIC() {
    return project.repoPublic
  },
}))

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
const writeClipboard = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  vi.clearAllMocks()
  project.repoPublic = false
  writeClipboard.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: writeClipboard } })
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
function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`缺少控件：${selector}`)
  return element
}
async function openFeedback() {
  const { root, open } = await mount(true)
  const opener = required<HTMLButtonElement>('[data-about-link="feedback"]', root)
  opener.focus()
  opener.click()
  await settle()
  return { root, open, opener, dialog: required('.dialog') }
}

it.each([false, true])('公开开关为%s时只控制反馈窗GitHub入口，关于链接始终显示', async (repoPublic) => {
  project.repoPublic = repoPublic
  const { root, open, dialog } = await openFeedback()
  expect(root.querySelectorAll('[data-about-link="github"]')).toHaveLength(1)
  expect(root.querySelectorAll('.full .links .link')).toHaveLength(4)
  expect(dialog.querySelectorAll('[aria-label="打开 GitHub 问题页"]')).toHaveLength(Number(repoPublic))
  expect(dialog.textContent).toContain('反馈问题')
  expect(dialog.textContent).toContain('可以通过以下方式联系到我。')
  expect(dialog.querySelectorAll('.feedback-or')).toHaveLength(Number(repoPublic))
  expect(dialog.textContent).toContain('v0.0.1')
  expect(dialog.textContent).toContain(FEEDBACK_EMAIL)
  expect(dialog.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0)
  expect(openLink).not.toHaveBeenCalled()
  required<HTMLButtonElement>('.dialog button.soft').click()
  open.value = false
  await settle()
  expect(root.querySelectorAll('.brief [data-about-link="github"]')).toHaveLength(1)
  expect(root.querySelectorAll('.brief .links .link')).toHaveLength(3)
})

it('复制邮箱只写剪贴板并显示提示，不打开浏览器', async () => {
  const { dialog } = await openFeedback()
  expect([...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['复制', '关闭'])
  required<HTMLButtonElement>('[aria-label="复制邮箱"]', dialog).click()
  await settle()
  expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(FEEDBACK_EMAIL)
  expect(toast).toHaveBeenCalledWith('邮箱已复制。')
  expect(openLink).not.toHaveBeenCalled()
})

it('复制失败提示手动复制，保留反馈窗', async () => {
  writeClipboard.mockRejectedValueOnce(new Error('模拟剪贴板不可用'))
  const { dialog } = await openFeedback()
  required<HTMLButtonElement>('[aria-label="复制邮箱"]', dialog).click()
  await settle()
  expect(toast).toHaveBeenCalledWith('邮箱复制失败，请手动复制。', { kind: 'error' })
  expect(document.querySelector('.dialog')).toBe(dialog)
})

it('公开后GitHub打开操作使用仓库issues地址', async () => {
  project.repoPublic = true
  const { dialog } = await openFeedback()
  expect(required('.feedback-or', dialog).textContent).toBe('或')
  required<HTMLButtonElement>('[aria-label="打开 GitHub 问题页"]', dialog).click()
  await settle()
  expect(openLink).toHaveBeenCalledExactlyOnceWith(`${GITHUB_URL}/issues`)
})

it.each([
  { name: '关闭按钮', close: () => required<HTMLButtonElement>('.dialog button.soft').click() },
  {
    name: 'Esc',
    close: () => required('.dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  },
  { name: '遮罩', close: () => required<HTMLDivElement>('.mask').click() },
])('$name关闭反馈窗并恢复到原入口焦点', async ({ close }) => {
  const { opener } = await openFeedback()
  close()
  await settle()
  expect(document.querySelector('.dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

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
