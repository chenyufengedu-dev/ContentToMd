// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import OnboardingPage from './OnboardingPage.vue'
import { defaultConfig, type Config } from '../core/config'
import { saveConfig, saveOnboarding, writeNote, pickFolder, inspectCollection } from '../shell/tauri'
import { testService } from '../core/services'
import { AppError } from '../core/errors'
import { toast } from '../components/useToast'

vi.mock('../shell/tauri', () => ({
  defaultCollectionFolder: vi.fn().mockResolvedValue('C:\\test\\收藏库'),
  listObsidianVaults: vi.fn().mockResolvedValue([]),
  listSubfolders: vi.fn().mockResolvedValue([]),
  pickFolder: vi.fn(),
  ensureSubfolder: vi.fn(),
  dirExists: vi.fn().mockResolvedValue(true),
  inspectCollection: vi.fn(async (config: Config) => ({ config, hasNotes: false })),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveOnboarding: vi.fn().mockResolvedValue(undefined),
  writeNote: vi.fn().mockResolvedValue('其他/欢迎使用 ContentToMd.md'),
  httpFetch: vi.fn(),
  openLink: vi.fn(),
  guardClose: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('../core/services', () => ({ testService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../components/useToast', () => ({ toast: vi.fn() }))
vi.mock('../components/OnboardingBrand.vue', () => ({ default: { template: '<span>品牌动画</span>' } }))

let app: App | undefined
const done = vi.fn()
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
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

it('未选目录直接跳过使用默认目录，仍写欢迎笔记，不保存密钥', async () => {
  await click('暂时跳过')
  await settle()
  expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ vaultPath: 'C:\\test\\收藏库' }))
  const saved = vi.mocked(saveConfig).mock.calls[0][0]
  expect(Object.values(saved.services).every((s) => s.apiKey === '')).toBe(true)
  expect(saveOnboarding).toHaveBeenCalledWith({ finished: true, celebrated: false })
  expect(done).toHaveBeenCalledWith(saved, '其他/欢迎使用 ContentToMd.md')
  expect(testService).not.toHaveBeenCalled()
  expect(writeNote).toHaveBeenCalledTimes(1)
})

it('已选择收藏库但跳过密钥，保留所选目录并返回欢迎笔记实际路径', async () => {
  vi.mocked(pickFolder).mockResolvedValueOnce('C:\\test\\朋友试用收藏库')
  vi.mocked(writeNote).mockResolvedValueOnce('其他/欢迎使用 ContentToMd-2026-10-27.md')
  await click('开始')
  await vi.advanceTimersByTimeAsync(40)
  await click('更换')
  await click('下一步')
  await vi.advanceTimersByTimeAsync(40)
  await click('暂时跳过')
  await settle()
  expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ vaultPath: 'C:\\test\\朋友试用收藏库' }))
  expect(writeNote).toHaveBeenCalledWith(
    'C:\\test\\朋友试用收藏库',
    '其他',
    '欢迎使用 ContentToMd',
    expect.any(String),
    expect.any(String),
  )
  expect(done).toHaveBeenCalledWith(expect.any(Object), '其他/欢迎使用 ContentToMd-2026-10-27.md')
})

it('连接已有笔记的收藏库时导入领域，不写欢迎笔记，也不返回欢迎入口', async () => {
  vi.mocked(pickFolder).mockResolvedValueOnce('C:\\test\\已有库')
  vi.mocked(inspectCollection).mockImplementationOnce(async (config) => ({
    config: { ...config, domains: [{ id: 1, name: '设计UI' }, { id: 2, name: 'AI与Agent' }, ...config.domains] },
    hasNotes: true,
  }))
  await click('开始')
  await vi.advanceTimersByTimeAsync(40)
  await click('更换')
  await click('下一步')
  await vi.advanceTimersByTimeAsync(40)
  await click('暂时跳过')
  await settle()
  expect(inspectCollection).toHaveBeenCalledTimes(1)
  const saved = vi.mocked(saveConfig).mock.lastCall?.[0]
  expect(saved?.vaultPath).toBe('C:\\test\\已有库')
  expect(saved?.domains.map((d) => d.name)).toEqual(['设计UI', 'AI与Agent', '其他'])
  expect(writeNote).not.toHaveBeenCalled()
  expect(done).toHaveBeenCalledWith(saved, undefined)
})

it('无法检查已有收藏库时不保存配置或写欢迎笔记，允许重试', async () => {
  vi.mocked(inspectCollection).mockRejectedValueOnce(new Error('无法读取领域目录'))
  await click('暂时跳过')
  await settle()
  expect(writeNote).not.toHaveBeenCalled()
  expect(saveConfig).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('无法读取领域目录')
})

it('文字和图片通过即可完成，音视频选填；实际保存所选服务', async () => {
  await click('开始')
  await vi.advanceTimersByTimeAsync(40)
  await click('下一步')
  await vi.advanceTimersByTimeAsync(40)
  expect(document.body.textContent).toContain('注册登录 → 充值几元 → 创建密钥并复制')
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
  expect(writeNote).toHaveBeenCalledTimes(1)
  const [root, domain, title, date, content] = vi.mocked(writeNote).mock.calls[0]
  expect(root).toBe('C:\\test\\收藏库')
  expect(domain).toBe('其他')
  expect(title).toBe('欢迎使用 ContentToMd')
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(content).toContain('title: "欢迎使用 ContentToMd"')
  expect(content).toContain('原文精修')
  expect(content).toContain('要点提炼')
  expect(content).toContain('视觉收藏')
  expect(content).toContain('设置 → 关于 → 反馈问题')
  expect(content).not.toContain('朋友试用版')
  expect(content).not.toContain('微信群')
  expect(done).toHaveBeenCalledWith(saved, '其他/欢迎使用 ContentToMd.md')
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
  vi.mocked(testService).mockRejectedValueOnce(new AppError('balance', '旧余额提示'))
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
  expect(document.body.textContent).toContain('DeepSeek 账户余额不足，请先充值。')
  await click('重试')
  await vi.advanceTimersByTimeAsync(650)
  await settle()
  expect(input.value).toBe('example-retry-key')
  vi.mocked(writeNote).mockRejectedValueOnce(new Error('临时收藏库无法写入'))
  await click('开始使用')
  await settle()
  expect(done).toHaveBeenCalled()
  expect(saveOnboarding).toHaveBeenCalledWith({ finished: true, celebrated: false })
  expect(toast).toHaveBeenCalledWith('配置已保存，但欢迎笔记写入失败：Error: 临时收藏库无法写入。', { kind: 'error' })
})
