// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import type * as DocText from '../core/docText'
import type * as Pipeline from '../core/pipeline'
import CollectPage from './CollectPage.vue'
import { defaultConfig } from '../core/config'
import { DEFAULT_PROMPTS } from '../core/defaultPrompts'
import { readDocx, readPdf } from '../core/docText'
import { runJob } from '../core/pipeline'
import { writeNote } from '../shell/tauri'

vi.mock('../shell/tauri', () => ({
  loadDraft: vi.fn().mockResolvedValue(null),
  guardClose: vi.fn().mockResolvedValue(() => {}),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  saveDraft: vi.fn().mockResolvedValue(undefined),
  listVaultTags: vi.fn().mockResolvedValue([]),
  appendUsage: vi.fn(),
  httpFetch: vi.fn(),
  destroyWindow: vi.fn(),
  writeNote: vi.fn().mockResolvedValue('为人处世/测试.md'),
}))
vi.mock('../core/docText', async (original) => ({
  ...(await original<typeof DocText>()),
  setPdfWorker: vi.fn(),
  readPdf: vi.fn(),
  readDocx: vi.fn(),
}))
vi.mock('../core/pipeline', async (original) => ({
  ...(await original<typeof Pipeline>()),
  runJob: vi.fn().mockRejectedValue(new Error('隔离测试停止处理')),
}))
let app: App | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
const bytes = (text: string) => new TextEncoder().encode(text).buffer
function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  let reject: (e: Error) => void = () => {}
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function flush() {
  for (let i = 0; i < 5; i++) await nextTick()
}
async function mount(active = true) {
  const config = reactive(defaultConfig())
  config.services.text.apiKey = 'isolated-test'
  const state = reactive({ active })
  const root = document.createElement('div')
  const goSettings = vi.fn()
  document.body.append(root)
  app = createApp({
    render: () => h(CollectPage, { config, prompts: DEFAULT_PROMPTS, active: state.active, onGoSettings: goSettings }),
  })
  app.mount(root)
  await flush()
  function pick(name: string, promise = Promise.resolve(bytes('测试正文'))) {
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('缺少文件输入框')
    const file = new File([], name, { type: name.endsWith('.png') ? 'image/png' : '' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => promise })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return { root, state, pick, config, goSettings }
}
it.each([
  ['测试.txt', '尚未配置文字整理服务，请先完成配置。'],
  ['测试.png', '尚未配置看图理解服务，请先完成配置。'],
  ['测试.mp3', '尚未配置语音转写服务，请先完成配置。'],
] as const)('缺少服务时%s显示设置主按钮，点击跳转而快捷键不触发', async (fileName, message) => {
  const { root, pick, config, goSettings } = await mount()
  config.services.text.apiKey = ''
  pick(fileName)
  await flush()
  const button = root.querySelector<HTMLButtonElement>('.actions .primary')
  if (!button) throw new Error('缺少主按钮')
  expect(button.textContent?.trim()).toBe('去配置服务')
  expect(button.disabled).toBe(false)
  expect(root.querySelector('.actions')?.textContent).toContain(message)
  expect(root.querySelector('.actions')?.previousElementSibling?.classList.contains('notice')).toBe(false)
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  expect(goSettings).not.toHaveBeenCalled()
  expect(runJob).not.toHaveBeenCalled()
  button.click()
  expect(goSettings).toHaveBeenCalledTimes(1)
  expect(runJob).not.toHaveBeenCalled()
})

it('服务配好后主按钮自动恢复开始处理并移除缺配置说明', async () => {
  const { root, pick, config, goSettings } = await mount()
  config.services.text.apiKey = ''
  pick('测试.txt')
  await flush()
  expect(root.querySelector('.actions .primary')?.textContent?.trim()).toBe('去配置服务')
  config.services.text.apiKey = 'isolated-restored'
  await flush()
  const button = root.querySelector<HTMLButtonElement>('.actions .primary')
  if (!button) throw new Error('缺少主按钮')
  expect(button.textContent).toContain('开始处理')
  expect(button.disabled).toBe(false)
  expect(root.querySelector('.actions')?.textContent).not.toContain('尚未配置')
  button.click()
  await flush()
  expect(runJob).toHaveBeenCalledTimes(1)
  expect(goSettings).not.toHaveBeenCalled()
})
it('较早的文字读取完成不能覆盖后来选择的文件', async () => {
  const { root, pick } = await mount()
  const old = deferred<ArrayBuffer>()
  pick('旧.txt', old.promise)
  pick('新.txt')
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('新.txt')
  old.resolve(bytes('迟到的旧正文'))
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('新.txt')
})
it.each(['pdf', 'docx'])('较早的%s解析失败不污染新的文件', async (ext) => {
  const { root, pick } = await mount()
  const old = deferred<Awaited<ReturnType<typeof readPdf>>>()
  vi.mocked(ext === 'pdf' ? readPdf : readDocx).mockReturnValueOnce(old.promise)
  pick(`旧.${ext}`)
  await flush()
  pick('新.txt')
  await flush()
  old.reject(new Error('旧文件损坏'))
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('新.txt')
  expect(root.querySelector('.notice')).toBeNull()
})
it('移除文件后，尚未完成的文字读取不能重新加入文件', async () => {
  const { root, pick } = await mount()
  pick('现有.txt')
  await flush()
  const old = deferred<ArrayBuffer>()
  pick('等待读取.txt', old.promise)
  const remove = root.querySelector<HTMLButtonElement>('[aria-label="移除文件"]')
  if (!remove) throw new Error('缺少移除按钮')
  remove.click()
  old.resolve(bytes('迟到'))
  await flush()
  expect(root.querySelector('.item-name')).toBeNull()
})
it('隐藏首页不拦截粘贴或响应开始快捷键，返回后恢复', async () => {
  const { root, state, pick } = await mount(false)
  pick('测试.txt')
  await flush()
  const paste = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(paste, 'clipboardData', { value: { files: [new File([''], '其他.txt')] } })
  document.body.dispatchEvent(paste)
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  expect(paste.defaultPrevented).toBe(false)
  expect(runJob).not.toHaveBeenCalled()
  state.active = true
  await flush()
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  expect(runJob).toHaveBeenCalledTimes(1)
  expect(root.textContent).toContain('隔离测试停止处理')
})
it('隐藏的确认页也不响应保存快捷键，返回后正常保存', async () => {
  const { root, state, pick } = await mount()
  vi.mocked(runJob).mockImplementationOnce(async (job) => {
    job.draft = {
      title: '测试笔记',
      domainId: 1,
      tags: [],
      keywords: [],
      summary: '',
      body: '正文',
      image_captions: [],
    }
  })
  pick('测试.txt')
  await flush()
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  expect(root.querySelector('textarea.title')).not.toBeNull()
  state.active = false
  await flush()
  const saveKey = new KeyboardEvent('keydown', { ctrlKey: true, key: 's', cancelable: true })
  window.dispatchEvent(saveKey)
  await flush()
  expect(writeNote).not.toHaveBeenCalled()
  expect(saveKey.defaultPrevented).toBe(false)
  state.active = true
  await flush()
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 's' }))
  await flush()
  expect(writeNote).toHaveBeenCalledTimes(1)
})
it.each(['pdf', 'docx'])('较早的%s解析成功也不能覆盖后来选择的文件', async (ext) => {
  const { root, pick } = await mount()
  const old = deferred<Awaited<ReturnType<typeof readPdf>>>()
  vi.mocked(ext === 'pdf' ? readPdf : readDocx).mockReturnValueOnce(old.promise)
  pick(`旧.${ext}`)
  await flush()
  pick('新.txt')
  await flush()
  old.resolve({ text: '旧文档的正文' })
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('新.txt')
})
it('当前文字读取失败显示提示，旧读取失败则丢弃', async () => {
  const { root, pick } = await mount()
  const old = deferred<ArrayBuffer>()
  const current = deferred<ArrayBuffer>()
  pick('旧.txt', old.promise)
  pick('新.txt', current.promise)
  old.reject(new Error('旧文件不可读'))
  await flush()
  expect(root.querySelector('.notice')).toBeNull()
  current.reject(new Error('新文件不可读'))
  await flush()
  expect(root.querySelector('.notice')?.textContent).toContain('新.txt')
})
it.each(['新.mp3', '新.png'])('选择%s后，旧文字读取不能混入当前内容', async (name) => {
  const { root, pick } = await mount()
  const old = deferred<ArrayBuffer>()
  pick('旧.txt', old.promise)
  pick(name)
  await flush()
  old.resolve(bytes('旧正文'))
  await flush()
  expect(root.textContent).not.toContain('旧.txt')
  if (name.endsWith('.png')) expect(root.querySelector('img')?.alt).toBe(name)
  else expect(root.querySelector('.item-name')?.textContent).toBe(name)
})
it('开始处理后丢弃尚未完成的导入，不替换正在处理的内容', async () => {
  const { root, pick } = await mount()
  pick('当前.txt')
  await flush()
  const old = deferred<ArrayBuffer>()
  pick('待完成.txt', old.promise)
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  old.resolve(bytes('旧正文'))
  await flush()
  expect(root.textContent).not.toContain('待完成.txt')
  expect(vi.mocked(runJob).mock.calls[0][0].fileName).toBe('当前.txt')
})
it('卸载后未完成的文档读取不再启动解析', async () => {
  const { pick } = await mount()
  const old = deferred<ArrayBuffer>()
  pick('旧.docx', old.promise)
  if (!app) throw new Error('页面未挂载')
  app.unmount()
  app = undefined
  old.resolve(bytes('迟到的正文'))
  await flush()
  expect(readDocx).not.toHaveBeenCalled()
})
it('旧音视频的检测错误不能取消新文件的读取', async () => {
  const { root, pick } = await mount()
  const create = vi.spyOn(document, 'createElement')
  pick('旧.mp3')
  const probe: unknown = create.mock.results.find(
    (r) => r.type === 'return' && r.value instanceof HTMLAudioElement,
  )?.value
  create.mockRestore()
  if (!(probe instanceof HTMLAudioElement)) throw new Error('未创建音频检测元素')
  const current = deferred<ArrayBuffer>()
  pick('新.txt', current.promise)
  probe.dispatchEvent(new Event('error'))
  current.resolve(bytes('新正文'))
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('新.txt')
  expect(root.querySelector('.notice')).toBeNull()
})
