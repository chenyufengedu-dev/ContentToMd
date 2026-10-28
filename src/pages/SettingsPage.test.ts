// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import SettingsPage from './SettingsPage.vue'
import { defaultConfig, type Config } from '../core/config'
import { saveConfig, countDomainNotes, deleteDomain, restoreDomain, guardClose } from '../shell/tauri'
import { toast } from '../components/useToast'
import { testService } from '../core/services'
import { AppError } from '../core/errors'
vi.mock('../core/services', () => ({ testService: vi.fn() }))
vi.mock('../components/useToast', () => ({ toast: vi.fn() }))

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
async function mount(price?: number, setup?: (config: Config) => void) {
  const config = defaultConfig()
  config.domains.unshift({ id: 1, name: '为人处世' })
  setup?.(config)
  config.services.text.price = price === undefined ? undefined : { input: price }
  const pending = vi.fn()
  const saved = vi.fn()
  const busy = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(SettingsPage, { config, firstRun: false, onPending: pending, onSaved: saved, onDomainBusy: busy })
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
  return { vm, root, pending, saved, busy, fill }
}
it.each([0, 1, 2])('服务%s重新输入同一密钥不提示待保存，真正修改及恢复按最终值判断', async (index) => {
  const keys = ['isolated-text-key', 'isolated-vision-key', 'isolated-asr-key']
  const view = await mount(undefined, (config) => {
    config.services.text.apiKey = keys[0]
    config.services.vision.apiKey = keys[1]
    config.services.asr.apiKey = keys[2]
  })
  const input = view.root.querySelectorAll<HTMLInputElement>('input[type="password"]')[index]
  if (!input) throw new Error('缺少密钥输入框')
  const fill = async (value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  await fill(`  ${keys[index]}  `)
  expect(view.root.querySelector('.save-bar')).toBeNull()
  expect(view.pending).not.toHaveBeenCalledWith(true)
  await fill('isolated-new-key')
  expect(view.pending).toHaveBeenLastCalledWith(true)
  await fill(keys[index])
  expect(view.pending).toHaveBeenLastCalledWith(false)
  await fill('')
  expect(view.pending).toHaveBeenLastCalledWith(false)
  await view.fill('1')
  await fill(keys[index])
  expect(view.pending).toHaveBeenLastCalledWith(true)
  expect(saveConfig).not.toHaveBeenCalled()
})
async function deleteFirstDomain(root: HTMLElement, existed = true) {
  vi.mocked(countDomainNotes).mockResolvedValue(existed ? 1 : 0)
  vi.mocked(deleteDomain).mockResolvedValue({ notes: existed ? 1 : 0, images: existed ? ['附件/a.png'] : [], existed })
  const button = root.querySelector<HTMLButtonElement>('[aria-label="删除领域 为人处世"]')
  if (!button) throw new Error('缺少领域删除入口')
  button.click()
  for (let i = 0; i < 4; i++) await nextTick()
  const confirm = document.querySelector<HTMLButtonElement>('.dialog button.danger')
  if (!confirm) throw new Error('缺少删除确认')
  confirm.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
it('连接失败保持短提示，原文通过复制按钮提供，不再展开详细信息', async () => {
  const { root } = await mount(undefined, (config) => {
    config.services.text.apiKey = 'isolated-key'
  })
  vi.mocked(testService).mockRejectedValueOnce(
    new AppError('network', '连接失败，请检查网络及接口地址。', 'TypeError: Failed to fetch'),
  )
  const test = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === '测试连接',
  )
  if (!test) throw new Error('没有测试连接按钮')
  test.click()
  for (let i = 0; i < 5; i++) await nextTick()
  expect(root.textContent).toContain('连接失败，请检查网络及接口地址。')
  expect(root.textContent).not.toContain('TypeError: Failed to fetch')
  expect(root.querySelector('details')).toBeNull()
  const copy = [...root.querySelectorAll('button')].find((button) => button.textContent === '复制错误信息')
  if (!copy) throw new Error('缺少复制错误入口')
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  copy.click()
  for (let i = 0; i < 3; i++) await nextTick()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('TypeError: Failed to fetch')
  expect(toast).toHaveBeenCalledWith('已复制，反馈问题时可以粘贴给作者。')
})
it('设置页卸载后关闭监听才返回，也立即解除，不留下隐藏页询问', async () => {
  let finish: ((release: Awaited<ReturnType<typeof guardClose>>) => void) | undefined
  const release = vi.fn()
  vi.mocked(guardClose).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await mount()
  app.unmount()
  if (!finish) throw new Error('关闭监听未登记')
  finish(release)
  await nextTick()
  expect(release).toHaveBeenCalledTimes(1)
})
it('隐私说明使用三句简明说明', async () => {
  const { root } = await mount()
  expect([...root.querySelectorAll('.privacy li')].map((li) => li.textContent)).toEqual([
    '只把你放进来的内容和“本次要求”发给你自己配置的 AI 服务，其他笔记和电脑信息都不发送。',
    '软件没有自己的服务器，不收集任何使用数据。',
    '密钥只保存在本机的 Windows 凭据管理器里。',
  ])
})
it('删除领域后配置保存失败，按已保存的位置恢复文件夹，列表保留', async () => {
  const { root } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('磁盘写入失败'))
  vi.mocked(restoreDomain).mockResolvedValue(undefined)
  await deleteFirstDomain(root)
  expect(restoreDomain).toHaveBeenCalledWith('隔离收藏库', '为人处世', ['附件/a.png'])
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).not.toBeNull()
  expect(root.textContent).toContain('文件夹已恢复')
})
it('配置和恢复都失败时，明确提示从回收站恢复，不能显示删除成功', async () => {
  const { root } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('保存失败'))
  vi.mocked(restoreDomain).mockRejectedValueOnce(new Error('恢复失败'))
  await deleteFirstDomain(root)
  expect(root.textContent).toContain('回收站')
  expect(root.textContent).toContain('恢复失败')
  expect(toast).not.toHaveBeenCalled()
})
it('原本未建文件夹的领域删除失败，不尝试还原不存在的回收站项目', async () => {
  const { root } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('保存失败'))
  await deleteFirstDomain(root, false)
  expect(restoreDomain).not.toHaveBeenCalled()
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).not.toBeNull()
})
it('撤销时文件恢复但配置写入失败，领域保留为待保存，能再次全局保存', async () => {
  const { vm, root, pending } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  vi.mocked(restoreDomain).mockResolvedValue(undefined)
  await deleteFirstDomain(root)
  const action = vi.mocked(toast).mock.lastCall?.[1]?.action
  if (!action) throw new Error('没有撤销入口')
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('撤销配置写入失败'))
  await action.run()
  await nextTick()
  expect(restoreDomain).toHaveBeenCalledWith('隔离收藏库', '为人处世', ['附件/a.png'])
  expect(root.textContent).toContain('文件已恢复')
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).not.toBeNull()
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(await vm.save()).toBe(true)
  expect(vi.mocked(saveConfig).mock.lastCall?.[0].domains.some((d) => d.name === '为人处世')).toBe(true)
})
it('删除失败后的恢复尚未结束时，报告忙碌并阻止全局保存及窗口关闭', async () => {
  const { vm, root, busy } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  let finish = () => {}
  vi.mocked(saveConfig).mockRejectedValueOnce(new Error('保存失败'))
  vi.mocked(restoreDomain).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  await deleteFirstDomain(root)
  expect(busy).toHaveBeenLastCalledWith(true)
  expect(await vm.save()).toBe(false)
  const closeGuard = vi.mocked(guardClose).mock.lastCall?.[0]
  if (!closeGuard) throw new Error('没有关闭保护')
  expect(closeGuard()).toBe(true)
  finish()
  for (let i = 0; i < 5; i++) await nextTick()
  expect(busy).toHaveBeenLastCalledWith(false)
})
it.each(['abc', '-1', 'Infinity', '1e999'])('无原价时输入 %s 也算未保存，禁止落盘', async (raw) => {
  const { vm, pending, fill, root } = await mount()
  await fill(raw)
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(await vm.save()).toBe(false)
  expect(saveConfig).not.toHaveBeenCalled()
  await nextTick()
  expect(root.textContent).toContain('大于或等于 0 的数字')
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
  expect(root.textContent).toContain('修改尚未保存')
  expect(await vm.save()).toBe(true)
  expect(vi.mocked(saveConfig).mock.calls[1][0].services.text.baseUrl).toBe('https://example.invalid/b')
})
