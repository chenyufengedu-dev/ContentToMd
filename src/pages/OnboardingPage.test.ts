// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import OnboardingPage from './OnboardingPage.vue'
import { defaultConfig } from '../core/config'
import { saveConfig, saveOnboarding } from '../shell/tauri'
import { testService } from '../core/services'

vi.mock('../shell/tauri', () => ({
  defaultCollectionFolder: vi.fn().mockResolvedValue('C:\\test\\收藏库'),
  listObsidianVaults: vi.fn().mockResolvedValue([]),
  listSubfolders: vi.fn().mockResolvedValue([]),
  pickFolder: vi.fn(),
  ensureSubfolder: vi.fn(),
  dirExists: vi.fn().mockResolvedValue(true),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveOnboarding: vi.fn().mockResolvedValue(undefined),
  httpFetch: vi.fn(),
  openLink: vi.fn(),
  guardClose: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('../core/services', () => ({ testService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../components/OnboardingBrand.vue', () => ({ default: { template: '<span>品牌动画</span>' } }))

let app: App | undefined
const done = vi.fn()
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )
  if (!button) throw new Error(`没有按钮：${text}`)
  button.click()
  await settle()
}
beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  document.body.innerHTML = '<div id="test"></div>'
  app = createApp({ render: () => h(OnboardingPage, { config: defaultConfig(), onDone: done }) })
  app.mount('#test')
  await settle()
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('跳过也进入首页，只保存默认目录，不保存密钥', async () => {
  await click('暂时跳过')
  await settle()
  expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ vaultPath: 'C:\\test\\收藏库' }))
  const saved = vi.mocked(saveConfig).mock.calls[0][0]
  expect(Object.values(saved.services).every((s) => s.apiKey === '')).toBe(true)
  expect(saveOnboarding).toHaveBeenCalledWith({ finished: true, celebrated: false })
  expect(done).toHaveBeenCalledWith(saved, true)
  expect(testService).not.toHaveBeenCalled()
})

it('文字和图片通过即可完成，音视频选填；实际保存所选服务', async () => {
  await click('开始')
  await vi.advanceTimersByTimeAsync(40)
  await click('下一步')
  await vi.advanceTimersByTimeAsync(40)
  const input = document.querySelector<HTMLInputElement>('[aria-label="DeepSeek API 密钥"]')
  if (!input) throw new Error('没有密钥输入框')
  input.value = 'example-not-a-real-key'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  await vi.advanceTimersByTimeAsync(650)
  await settle()
  expect(testService).toHaveBeenCalledTimes(2)
  await click('开始使用')
  await settle()
  const saved = vi.mocked(saveConfig).mock.calls[0][0]
  expect(saved.services.text.apiKey).toBe('example-not-a-real-key')
  expect(saved.services.vision.apiKey).toBe('example-not-a-real-key')
  expect(saved.services.asr.apiKey).toBe('')
  expect(done).toHaveBeenCalledWith(saved, false)
})

it('保存失败不退出，也不标记引导完成', async () => {
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('无法写入测试配置'))
  await click('暂时跳过')
  await settle()
  expect(done).not.toHaveBeenCalled()
  expect(saveOnboarding).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('无法写入测试配置')
})

it('连接失败可以原位重试，不要求重新填写同一密钥', async () => {
  vi.mocked(testService).mockRejectedValueOnce(new Error('测试网络失败'))
  await click('开始')
  await vi.advanceTimersByTimeAsync(40)
  await click('下一步')
  await vi.advanceTimersByTimeAsync(40)
  const input = document.querySelector<HTMLInputElement>('[aria-label="DeepSeek API 密钥"]')
  if (!input) throw new Error('没有密钥输入框')
  input.value = 'example-retry-key'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  await vi.advanceTimersByTimeAsync(650)
  await settle()
  await click('重试')
  await vi.advanceTimersByTimeAsync(650)
  await settle()
  expect(input.value).toBe('example-retry-key')
  await click('开始使用')
  await settle()
  expect(done).toHaveBeenCalled()
})
