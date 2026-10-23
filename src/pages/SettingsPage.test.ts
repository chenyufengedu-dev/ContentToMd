// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import SettingsPage from './SettingsPage.vue'
import { defaultConfig } from '../core/config'
import { saveConfig } from '../shell/tauri'

vi.mock('../shell/tauri', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
  readUsage: vi.fn().mockResolvedValue([]),
  listObsidianVaults: vi.fn().mockResolvedValue([]),
  dirExists: vi.fn().mockResolvedValue(false),
  listSubfolders: vi.fn().mockResolvedValue([]),
  guardClose: vi.fn().mockResolvedValue(() => {}),
  pickFolder: vi.fn(),
  countDomainNotes: vi.fn(),
  deleteDomain: vi.fn(),
  restoreDomain: vi.fn(),
  httpFetch: vi.fn(),
  ensureSubfolder: vi.fn(),
  destroyWindow: vi.fn(),
}))
let app: App
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
async function mount(price?: number) {
  const config = defaultConfig()
  config.services.text.price = price === undefined ? undefined : { input: price }
  const pending = vi.fn()
  const saved = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(SettingsPage, { config, firstRun: false, onPending: pending, onSaved: saved })
  // Vue 的组件实例暴露了 defineExpose({ save })。
  const vm = app.mount(root) as InstanceType<typeof SettingsPage>
  const toggle = root.querySelector<HTMLButtonElement>('.price-toggle')
  if (!toggle) throw new Error('缺少价格开关')
  toggle.click()
  await nextTick()
  const field = root.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
  if (!field) throw new Error('缺少价格输入框')
  const input = field
  async function fill(value: string) {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  return { vm, root, pending, saved, fill }
}
it.each(['abc', '-1', 'Infinity', '1e999'])('无原价时输入 %s 也算未保存，禁止落盘', async (raw) => {
  const { vm, pending, fill, root } = await mount()
  await fill(raw)
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(await vm.save()).toBe(false)
  expect(saveConfig).not.toHaveBeenCalled()
  await nextTick()
  expect(root.textContent).toContain('非负数')
})
it('错误价格不能覆盖原价，修正后全局保存才写入', async () => {
  const { vm, fill } = await mount(2)
  await fill('错误')
  expect(await vm.save()).toBe(false)
  expect(saveConfig).not.toHaveBeenCalled()
  await fill('0')
  expect(saveConfig).not.toHaveBeenCalled()
  expect(await vm.save()).toBe(true)
  expect(vi.mocked(saveConfig).mock.calls[0][0].services.text.price?.input).toBe(0)
})
it('清空价格可保存为未填写', async () => {
  const { vm, fill } = await mount(2)
  await fill('')
  expect(await vm.save()).toBe(true)
  expect(vi.mocked(saveConfig).mock.calls[0][0].services.text.price).toBeUndefined()
})

it('保存只确认提交快照，保存期间的新输入仍待保存且不能触发离开', async () => {
  const { vm, root, pending, saved } = await mount()
  const field = root.querySelector<HTMLInputElement>('input[placeholder="https://api.example.com/v1"]')
  if (!field) throw new Error('缺少接口地址输入框')
  let finish = () => {}
  let payload = ''
  vi.mocked(saveConfig).mockImplementationOnce(async (config) => {
    payload = JSON.stringify(config)
    await new Promise<void>((resolve) => (finish = resolve))
  })
  field.value = 'https://example.invalid/a'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const saving = vm.save()
  field.value = 'https://example.invalid/b'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(await vm.save()).toBe(false)
  expect(saveConfig).toHaveBeenCalledTimes(1)
  finish()
  expect(await saving).toBe(false)
  await nextTick()
  expect(JSON.parse(payload).services.text.baseUrl).toBe('https://example.invalid/a')
  expect(saved.mock.calls[0][0].services.text.baseUrl).toBe('https://example.invalid/a')
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(root.textContent).toContain('有改动还没保存')
  expect(await vm.save()).toBe(true)
  expect(vi.mocked(saveConfig).mock.calls[1][0].services.text.baseUrl).toBe('https://example.invalid/b')
})
