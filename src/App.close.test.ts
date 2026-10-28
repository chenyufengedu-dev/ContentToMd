// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import App from './App.vue'
import { defaultConfig } from './core/config'
import { DEFAULT_PROMPTS } from './core/defaultPrompts'

const guards = vi.hoisted(() => new Set<{ shouldAsk: () => boolean; ask: () => void }>())
vi.mock('./shell/tauri', () => ({
  loadConfigJson: async () => JSON.stringify(defaultConfig()),
  loadOnboarding: async () => ({ finished: true, celebrated: true }),
  ensurePrompts: async () => DEFAULT_PROMPTS,
  dirExists: async () => true,
  listEditRecoveries: async () => [],
  loadDraft: async () => null,
  guardClose: async (shouldAsk: () => boolean, ask: () => void) => {
    const entry = { shouldAsk, ask }
    guards.add(entry)
    return () => guards.delete(entry)
  },
  clearDraft: vi.fn(),
  saveDraft: vi.fn(),
  listVaultTags: async () => [],
  appendUsage: vi.fn(),
  httpFetch: vi.fn(),
  destroyWindow: vi.fn(),
}))
vi.mock('./components/pageFade', () => ({ vPageFade: {} }))
vi.mock('./components/TitleBar.vue', () => ({
  default: {
    props: ['page'],
    emits: ['navigate'],
    template: `<header :data-page="page"><button @click="$emit('navigate', 'settings')">去设置测试</button><button @click="$emit('navigate', 'library')">去收藏库测试</button></header>`,
  },
}))
vi.mock('./pages/SettingsPage.vue', () => ({
  default: {
    emits: ['pending'],
    template: `<section><input data-source="设置" @input="$emit('pending', true)"></section>`,
  },
}))
vi.mock('./pages/LibraryPage.vue', () => ({
  default: {
    emits: ['open'],
    template: `<div><input data-source="收藏库"><button @click="$emit('open', '其他/测试.md')">打开笔记测试</button></div>`,
  },
}))
vi.mock('./pages/NotePage.vue', () => ({
  default: {
    emits: ['dirty'],
    template: `<section><input data-source="笔记" @input="$emit('dirty', true)"></section>`,
  },
}))
let app: VueApp | undefined
afterEach(() => {
  app?.unmount()
  guards.clear()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
async function settle() {
  for (let i = 0; i < 10; i++) await nextTick()
}
function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!button) throw new Error(`缺少按钮${text}`)
  button.click()
}
it.each(['设置', '收藏库', '笔记'])('在%s页关闭时切回新增页，关闭询问可见', async (destination) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  document.body.innerHTML = '<div id="test"></div>'
  app = createApp(App)
  app.mount('#test')
  await settle()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('新增页没有文件入口')
  const file = new File([], '隔离文本.txt')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('尚未处理的内容').buffer })
  Object.defineProperty(input, 'files', { value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  click(destination === '设置' ? '去设置测试' : '去收藏库测试')
  await settle()
  if (destination === '笔记') {
    click('打开笔记测试')
    await settle()
  }
  const sourceInput = document.querySelector<HTMLInputElement>(`[data-source="${destination}"]`)
  if (!sourceInput) throw new Error('原页输入框缺失')
  sourceInput.value = '尚未保存的输入'
  sourceInput.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  expect(document.querySelector('header')?.getAttribute('data-page')).toBe(
    destination === '设置' ? 'settings' : 'library',
  )
  const guard = [...guards].find((g) => g.shouldAsk())
  if (!guard) throw new Error('未拦截关闭')
  guard.ask()
  await settle()
  expect(document.querySelector('header')?.getAttribute('data-page')).toBe('home')
  const dialog = document.querySelector('[role="alertdialog"]')
  expect(dialog?.textContent).toContain('关闭软件？')
  expect(dialog?.closest('[style*="display: none"]')).toBeNull()
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
  expect(sourceInput.isConnected).toBe(true)
  guard.ask()
  await settle()
  expect(sourceInput.isConnected).toBe(true)
  click('暂不关闭')
  await settle()
  expect(document.querySelector('header')?.getAttribute('data-page')).toBe(
    destination === '设置' ? 'settings' : 'library',
  )
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(document.querySelector(`[data-source="${destination}"]`)).toBe(sourceInput)
  expect(sourceInput.value).toBe('尚未保存的输入')
})
