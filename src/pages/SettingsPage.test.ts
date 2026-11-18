// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import SettingsPage from './SettingsPage.vue'
import { defaultConfig, type Config } from '../core/config'
import { DEFAULT_PROMPTS, editablePromptText } from '../core/defaultPrompts'
import {
  saveConfig,
  countDomainNotes,
  renameDomain,
  deleteDomain,
  restoreDomain,
  guardClose,
  inspectCollection,
  pickFolder,
  writeClipboard,
} from '../shell/tauri'
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
  listSystemFonts: vi.fn().mockResolvedValue([['PingFang SC', '苹方-简']]),
  listSubfolders: vi.fn().mockResolvedValue([]),
  guardClose: vi.fn().mockResolvedValue(() => {}),
  pickFolder: vi.fn(),
  writeClipboard: vi.fn(),
  countDomainNotes: vi.fn(),
  renameDomain: vi.fn().mockResolvedValue(undefined),
  deleteDomain: vi.fn(),
  restoreDomain: vi.fn(),
  httpFetch: vi.fn(),
  ensureSubfolder: vi.fn(),
  destroyWindow: vi.fn(),
  inspectCollection: vi.fn(async (config: Config) => ({ config, hasNotes: false })),
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
  app = createApp(SettingsPage, {
    config,
    firstRun: false,
    prompts: { ...DEFAULT_PROMPTS, 要点提炼: '整理方式：要点提炼\n本机默认指令。' },
    onPending: pending,
    onSaved: saved,
    onDomainBusy: busy,
  })
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
  const writeText = vi.mocked(writeClipboard).mockResolvedValueOnce(undefined)
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

it('切换到已有收藏库时，重建领域后保存，不沿用旧库领域', async () => {
  const { root, vm, saved } = await mount()
  vi.mocked(pickFolder).mockResolvedValueOnce('C:\\test\\已有库')
  vi.mocked(inspectCollection).mockImplementationOnce(async (config) => ({
    config: { ...config, domains: [{ id: 1, name: '设计UI' }, ...config.domains] },
    hasNotes: true,
  }))
  const choose = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '选择文件夹')
  if (!choose) throw new Error('缺少选择文件夹按钮')
  choose.click()
  for (let i = 0; i < 3; i++) await nextTick()
  expect(await vm.save()).toBe(true)
  expect(inspectCollection).toHaveBeenCalledWith(
    expect.objectContaining({
      vaultPath: 'C:\\test\\已有库',
      domains: [{ id: 99, name: '其他' }],
    }),
  )
  expect(saved.mock.lastCall?.[0].domains.map((d: { name: string }) => d.name)).toEqual(['设计UI', '其他'])
  expect(root.querySelector('[aria-label="删除领域 设计UI"]')).not.toBeNull()
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).toBeNull()
})
it('切换到空收藏库后只有其他，同一收藏库保存设置则保留自建领域', async () => {
  const { root, vm, saved } = await mount(undefined, (config) => {
    config.vaultPath = 'C:\\test\\旧库'
  })
  expect(await vm.save()).toBe(true)
  expect(inspectCollection).not.toHaveBeenCalled()
  expect(saved.mock.lastCall?.[0].domains.map((d: { name: string }) => d.name)).toEqual(['为人处世', '其他'])
  vi.mocked(pickFolder).mockResolvedValueOnce('C:\\test\\空库')
  const choose = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '选择文件夹')
  if (!choose) throw new Error('缺少选择文件夹按钮')
  choose.click()
  for (let i = 0; i < 3; i++) await nextTick()
  expect(await vm.save()).toBe(true)
  expect(saved.mock.lastCall?.[0].domains).toEqual([{ id: 99, name: '其他' }])
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).toBeNull()
})

it('新收藏库读取失败时，不保存新配置或清除旧领域', async () => {
  const { root, vm, saved } = await mount()
  vi.mocked(pickFolder).mockResolvedValueOnce('C:\\test\\不可读库')
  vi.mocked(inspectCollection).mockRejectedValueOnce(new Error('模拟目录读取失败'))
  const choose = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '选择文件夹')
  if (!choose) throw new Error('缺少选择文件夹按钮')
  choose.click()
  for (let i = 0; i < 3; i++) await nextTick()
  expect(await vm.save()).toBe(false)
  expect(saved).not.toHaveBeenCalled()
  expect(saveConfig).not.toHaveBeenCalled()
  expect(root.querySelector('[aria-label="删除领域 为人处世"]')).not.toBeNull()
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

it('保存自定义指令和字体，并可将单项指令恢复到软件默认值', async () => {
  const { root, vm, saved } = await mount(undefined, (config) => {
    config.promptOverrides = { 要点提炼: '原有的自定义指令' }
  })
  const click = async (scope: ParentNode, text: string) => {
    const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(text))
    if (!button) throw new Error('缺少按钮 ' + text)
    button.click()
    await nextTick()
  }
  root.querySelector<HTMLElement>('[data-card=prompts]')!.click()
  await nextTick()
  await click(root.querySelector('[data-card=prompts]')!, '要点提炼')
  const prompt = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="整理指令"]')!
  expect(prompt.readOnly).toBe(false)
  prompt.value = '保留定义和使用步骤。'
  prompt.dispatchEvent(new Event('input', { bubbles: true }))
  await click(root.querySelector('.prompt-editor')!, '完成')
  root.querySelector<HTMLElement>('[data-card=appearance]')!.click()
  await nextTick()
  await click(root.querySelector('[data-card=appearance]')!, '界面字体')
  const font = root.querySelector<HTMLInputElement>('[aria-label=搜索字体]')!
  font.value = '苹方'
  font.dispatchEvent(new Event('input', { bubbles: true }))
  await click(font.closest('[role=alertdialog]')!, 'PingFang SC')
  await click(font.closest('[role=alertdialog]')!, '完成')
  expect(await vm.save()).toBe(true)
  expect(saved.mock.lastCall?.[0]).toMatchObject({
    interfaceFont: 'PingFang SC',
    promptOverrides: { 要点提炼: '保留定义和使用步骤。' },
  })
  root.querySelector<HTMLElement>('[data-card=prompts]')!.click()
  await nextTick()
  await click(root.querySelector('[data-card=prompts]')!, '要点提炼')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
  root.querySelector<HTMLButtonElement>('[role=combobox][aria-label=指令来源]')!.click()
  await nextTick()
  const defaultOption = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(
    (option) => option.textContent?.trim() === '系统默认',
  )
  if (!defaultOption) throw new Error('缺少系统默认指令选项')
  defaultOption.click()
  await nextTick()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  const restored = root.querySelector<HTMLTextAreaElement>('textarea[aria-label=整理指令]')!
  expect(restored.readOnly).toBe(true)
  expect(restored.value).toContain('整理方式：要点提炼')
  expect(restored.value).toContain('本机默认指令。')
  expect(restored.value).not.toContain('只返回一个 JSON 对象')
  await click(root.querySelector('.prompt-editor')!, '完成')
  expect(await vm.save()).toBe(true)
  expect(saved.mock.lastCall?.[0].promptOverrides?.要点提炼).toBeUndefined()
})

it('直接新建指令后可以撤销，再新建并保存为当前模式的指令', async () => {
  const { root, vm, pending, saved } = await mount(undefined, (config) => {
    config.promptFiles = [{ id: 'existing', mode: '要点提炼', name: '原有指令', text: '原正文' }]
    config.promptOverrides = { 要点提炼: '原正文' }
  })
  const click = async (scope: ParentNode, label: string) => {
    const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
    expect(button).toBeDefined()
    button!.click()
    await nextTick()
  }
  const create = async () => {
    vm.openPromptEditor('要点提炼')
    await nextTick()
    const existing = root.querySelector<HTMLTextAreaElement>('[aria-label=整理指令]')!
    expect(existing.value).toBe('原正文')
    existing.value = '修改后的原正文'
    existing.dispatchEvent(new Event('input', { bubbles: true }))
    await click(root, '新建指令')
    const dialogs = root.querySelectorAll('[role=alertdialog]')
    const dialog = dialogs[dialogs.length - 1]
    const name = dialog.querySelector('input')!
    const text = dialog.querySelector('textarea')!
    name.value = '我的指令'
    text.value = '## 先列出步骤'
    for (const field of [name, text]) field.dispatchEvent(new Event('input', { bubbles: true }))
    await click(dialog, '完成')
    expect(root.querySelector('[aria-label=指令来源]')?.textContent).toContain('我的指令')
    await click(root.querySelector('.prompt-editor')!, '完成')
  }
  await create()
  await click(root.querySelector('.save-bar')!, '撤销')
  expect(pending).toHaveBeenLastCalledWith(false)
  await create()
  expect(await vm.save()).toBe(true)
  const config = saved.mock.lastCall?.[0] as Config
  expect(config.promptFiles).toMatchObject([
    { id: 'existing', text: '修改后的原正文' },
    { name: '我的指令', mode: '要点提炼', text: '## 先列出步骤' },
  ])
  expect(config.promptFileSelections?.要点提炼).toBe(config.promptFiles?.[1].id)
  expect(config.promptOverrides?.要点提炼).toBe('## 先列出步骤')
})

it('撤销整批设置后，旧的删除撤销不能重新加入指令', async () => {
  const { root, vm, pending } = await mount()
  const click = async (scope: ParentNode, label: string) => {
    const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!
    button.click()
    await nextTick()
  }
  vm.openPromptEditor('要点提炼')
  await nextTick()
  await click(root, '新建指令')
  const form = Array.from(root.querySelectorAll('[role=alertdialog]')).at(-1)!
  const name = form.querySelector('input')!
  const text = form.querySelector('textarea')!
  name.value = '测试指令'
  text.value = '测试正文'
  for (const field of [name, text]) field.dispatchEvent(new Event('input', { bubbles: true }))
  await click(form, '完成')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
  root.querySelector<HTMLButtonElement>('[aria-label=指令来源]')!.click()
  await nextTick()
  document.querySelector<HTMLButtonElement>('[aria-label=删除指令]')!.click()
  await nextTick()
  const dialogs = root.querySelectorAll('[role=alertdialog]')
  await click(dialogs[dialogs.length - 1], '删除')
  const undo = vi.mocked(toast).mock.lastCall?.[1]?.action?.run
  expect(undo).toBeDefined()
  await click(root.querySelector('.prompt-editor')!, '完成')
  await click(root.querySelector('.save-bar')!, '撤销')
  undo!()
  await nextTick()
  expect(pending).toHaveBeenLastCalledWith(false)
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('旧配置里保存的默认正文显示为系统默认', async () => {
  const { root, vm } = await mount(undefined, (config) => {
    config.promptOverrides = { 要点提炼: editablePromptText('要点提炼', DEFAULT_PROMPTS.要点提炼) }
  })
  vm.openPromptEditor('要点提炼')
  await nextTick()
  expect(root.querySelector('[aria-label=指令来源]')?.textContent).toContain('系统默认')
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label=整理指令]')?.readOnly).toBe(true)
})

it.each([undefined, 'Arial'])('撤销字体修改后恢复已保存的字体 %s', async (original) => {
  const { root, pending } = await mount(undefined, (config) => {
    if (original) config.interfaceFont = original
  })
  root.querySelector<HTMLElement>('[data-card=appearance]')!.click()
  await nextTick()
  root.querySelector<HTMLButtonElement>('[data-card=appearance] .settings-entry')!.click()
  await nextTick()
  const font = root.querySelector<HTMLInputElement>('[aria-label=搜索字体]')!
  font.value = '苹方'
  font.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const clickButton = (scope: ParentNode, label: string) =>
    [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!.click()
  clickButton(font.closest('[role=alertdialog]')!, 'PingFang SC')
  clickButton(font.closest('[role=alertdialog]')!, '完成')
  await nextTick()
  expect(pending).toHaveBeenLastCalledWith(true)
  clickButton(root.querySelector('.save-bar')!, '撤销')
  await nextTick()
  expect(pending).toHaveBeenLastCalledWith(false)
  expect(root.querySelector('[data-card=appearance] .entry-value')?.textContent).toBe(original ?? '思源黑体（默认）')
})

it('领域改名失败保留旧配置，成功后才更新名称', async () => {
  const { root, saved } = await mount(undefined, (config) => (config.vaultPath = '隔离收藏库'))
  const click = async (scope: ParentNode, label: string) => {
    ;[...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!.click()
    await nextTick()
    await nextTick()
  }
  await click(root, '为人处世')
  const field = root.querySelector<HTMLInputElement>('.domains input')!
  field.value = '读书笔记'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  vi.mocked(renameDomain).mockRejectedValueOnce(new Error('目标已存在'))
  await click(root.querySelector('.domains')!, '确定')
  expect(root.textContent).toContain('目标已存在')
  expect(saved).not.toHaveBeenCalled()
  await click(root.querySelector('.domains')!, '确定')
  expect(renameDomain).toHaveBeenLastCalledWith(
    '隔离收藏库',
    '为人处世',
    '读书笔记',
    expect.objectContaining({ domains: expect.arrayContaining([{ id: 1, name: '读书笔记' }]) }),
  )
  expect(root.querySelector('[aria-label="删除领域 读书笔记"]')).not.toBeNull()
  expect(saved).toHaveBeenCalledTimes(1)
})

it('删除导入字体可撤销', async () => {
  const { root, vm } = await mount(undefined, (config) => {
    config.interfaceFont = 'ctmd-font-saved'
    config.importedFonts = [{ family: 'ctmd-font-saved', name: '已导入.ttf', fileId: 'a'.repeat(64) }]
  })
  const click = async (scope: ParentNode, label: string) => {
    ;[...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!.click()
    await nextTick()
  }
  root.querySelector<HTMLElement>('[data-card=appearance]')!.click()
  await nextTick()
  await click(root.querySelector('[data-card=appearance]')!, '界面字体已导入.ttf')
  root.querySelector<HTMLButtonElement>('[aria-label="删除字体 已导入.ttf"]')!.click()
  await nextTick()
  await click(root, '完成')
  await click(root.querySelector('.save-bar')!, '撤销')
  expect(root.querySelector('[data-card=appearance] .entry-value')?.textContent).toBe('已导入.ttf')
  expect(await vm.save()).toBe(true)
  expect(saveConfig).toHaveBeenLastCalledWith(
    expect.objectContaining({
      interfaceFont: 'ctmd-font-saved',
      importedFonts: [{ family: 'ctmd-font-saved', name: '已导入.ttf', fileId: 'a'.repeat(64) }],
    }),
  )
})
