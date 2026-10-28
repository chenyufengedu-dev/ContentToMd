/* eslint-disable vue/one-component-per-file -- 入口测试在同一文件隔离多个页面和动画组件。 */
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App as VueApp } from 'vue'
import App from './App.vue'
import { defaultConfig } from './core/config'
import { current, dismiss } from './components/useToast'
import { loadConfigJson, loadOnboarding, saveOnboarding } from './shell/tauri'

vi.mock('./shell/tauri', () => ({
  loadConfigJson: vi.fn().mockResolvedValue(null),
  loadOnboarding: vi.fn().mockResolvedValue({ finished: false, celebrated: false }),
  saveOnboarding: vi.fn().mockResolvedValue(undefined),
  ensurePrompts: vi.fn().mockResolvedValue({}),
  dirExists: vi.fn().mockResolvedValue(true),
  listEditRecoveries: vi.fn().mockResolvedValue([]),
  restoreNote: vi.fn(),
}))
vi.mock('./pages/OnboardingPage.vue', () => ({
  default: {
    props: ['config'],
    emits: ['done'],
    template:
      "<button @click=\"$emit('done', config, '其他/欢迎使用 ContentToMd-2026-10-27.md')\">跳过引导测试</button>",
  },
}))
vi.mock('./pages/CollectPage.vue', () => ({ default: { template: '<div data-test="home">真实首页入口</div>' } }))
vi.mock('./pages/SettingsPage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./pages/LibraryPage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./pages/NotePage.vue', () => ({
  default: { props: ['path'], template: '<div data-test="note">{{ path }}</div>' },
}))
vi.mock('./components/TitleBar.vue', () => ({ default: { template: '<header />' } }))
vi.mock('./components/WelcomeCelebration.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      emits: ['played'],
      mounted() {
        this.$emit('played')
      },
      template: '<canvas data-test="celebration" />',
    }),
  }
})
vi.mock('./components/pageFade', () => ({ vPageFade: {} }))
let app: VueApp | undefined
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await nextTick()
}
async function mount() {
  document.body.innerHTML = '<div id="test"></div>'
  app = createApp({ render: () => h(App) })
  app.mount('#test')
  await settle()
}
beforeEach(() => {
  dismiss()
  vi.clearAllMocks()
  vi.mocked(loadConfigJson).mockResolvedValue(null)
  vi.mocked(loadOnboarding).mockResolvedValue({ finished: false, celebrated: false })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => {
  dismiss()
  app?.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

it('首次进入引导，跳过后挂载真实首页并记录礼花', async () => {
  await mount()
  expect(document.querySelector('[data-test="home"]')).toBeNull()
  document.querySelector('button')?.click()
  await settle()
  expect(document.querySelector('[data-test="home"]')).not.toBeNull()
  expect(saveOnboarding).toHaveBeenCalledWith({ finished: true, celebrated: true })
  expect(current.value?.text).toBe('欢迎笔记已放进收藏库，可以先看看。')
  const action = current.value?.action
  if (!action) throw new Error('欢迎提示缺少打开入口')
  expect(action.label).toBe('去看看')
  action.run()
  await settle()
  expect(document.querySelector('[data-test="note"]')?.textContent).toBe('其他/欢迎使用 ContentToMd-2026-10-27.md')
})

it('已有配置的老用户不重新引导或播放礼花', async () => {
  vi.mocked(loadConfigJson).mockResolvedValue(JSON.stringify(defaultConfig()))
  await mount()
  expect(document.body.textContent).not.toContain('跳过引导测试')
  expect(document.querySelector('[data-test="home"]')).not.toBeNull()
  expect(document.querySelector('[data-test="celebration"]')).toBeNull()
})

it('跳过后重启保持首页，不因音视频未配置再次引导或庆祝', async () => {
  vi.mocked(loadConfigJson).mockResolvedValue(JSON.stringify(defaultConfig()))
  vi.mocked(loadOnboarding).mockResolvedValue({ finished: true, celebrated: true })
  await mount()
  expect(document.body.textContent).not.toContain('跳过引导测试')
  expect(document.querySelector('[data-test="celebration"]')).toBeNull()
  expect(saveOnboarding).not.toHaveBeenCalled()
})
