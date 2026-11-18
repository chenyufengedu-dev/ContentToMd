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
import { loadDraft, writeNote, guardClose, listVaultTags, writeClipboard } from '../shell/tauri'

vi.mock('../shell/tauri', () => ({
  loadDraft: vi.fn().mockResolvedValue(null),
  guardClose: vi.fn().mockResolvedValue(() => {}),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  saveDraft: vi.fn().mockResolvedValue(undefined),
  listVaultTags: vi.fn().mockResolvedValue([]),
  appendUsage: vi.fn(),
  writeClipboard: vi.fn().mockResolvedValue(undefined),
  httpFetch: vi.fn(),
  destroyWindow: vi.fn(),
  writeAttachment: vi.fn().mockResolvedValue('附件/2026-11/测试-原文.txt'),
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
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }))
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
  const revealForClose = vi.fn(() => (state.active = true))
  document.body.append(root)
  app = createApp({
    render: () =>
      h(CollectPage, {
        config,
        prompts: DEFAULT_PROMPTS,
        active: state.active,
        onGoSettings: goSettings,
        onRevealForClose: revealForClose,
      }),
  })
  app.mount(root)
  await flush()
  function pickFiles(files: File[]) {
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('缺少文件输入框')
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function pick(name: string, promise = Promise.resolve(bytes('测试正文'))) {
    const file = new File([], name, { type: name.endsWith('.png') ? 'image/png' : '' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => promise })
    pickFiles([file])
  }
  return { root, state, pick, pickFiles, config, goSettings, revealForClose }
}
it('隐藏页有未处理内容时，先请求App显示新增页，再显示关闭询问', async () => {
  const { root, pick, state, revealForClose } = await mount(false)
  pick('未处理.txt')
  await flush()
  const guard = vi.mocked(guardClose).mock.lastCall
  if (!guard) throw new Error('缺少关闭保护')
  expect(guard[0]()).toBe(true)
  guard[1]()
  expect(revealForClose).toHaveBeenCalledTimes(1)
  expect(state.active).toBe(true)
  expect(root.textContent).not.toContain('关闭软件？')
  await flush()
  expect(root.textContent).toContain('关闭软件？')
})
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
  expect(root.textContent).toContain('操作失败，请重试。')
  const copy = [...root.querySelectorAll('button')].find((b) => b.textContent === '复制错误信息')
  if (!copy) throw new Error('缺少错误原文复制入口')
  copy.click()
  await flush()
  expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('隔离测试停止处理')
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
it('导入 Markdown 保留本次手动选择，移除后下一份文件恢复推荐', async () => {
  const { root, pick } = await mount()
  const points = [...root.querySelectorAll<HTMLButtonElement>('button.mode')].find(
    (button) => button.textContent?.trim() === '要点提炼',
  )!
  points.click()
  pick('测试.md', Promise.resolve(bytes('用于整理的测试正文')))
  await flush()
  expect(root.querySelector('.item-name')?.textContent).toBe('测试.md')
  expect(points.getAttribute('aria-pressed')).toBe('true')
  expect(root.textContent).not.toContain('已按文件类型选择')
  root.querySelector<HTMLButtonElement>('[aria-label=移除文件]')!.click()
  pick('下一份.md', Promise.resolve(bytes('下一份测试正文')))
  await flush()
  expect(root.querySelector('button.mode[aria-pressed=true]')?.textContent?.trim()).toBe('原文精修')
  expect(root.textContent).toContain('已按文件类型选择')
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
it('读取收藏库标签期间连续开始只运行一次', async () => {
  const { pick } = await mount()
  pick('当前.txt')
  await flush()
  const tags = deferred<string[]>()
  vi.mocked(listVaultTags).mockReturnValueOnce(tags.promise)
  for (let i = 0; i < 2; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  }
  expect(listVaultTags).toHaveBeenCalledTimes(1)
  expect(runJob).not.toHaveBeenCalled()
  tags.resolve([])
  await flush()
  expect(runJob).toHaveBeenCalledTimes(1)
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

it('图片导入先解码，坏图提示文件名，后续正常图仍可导入', async () => {
  const bitmap = { width: 1, height: 1, close: vi.fn() }
  const decode = vi.mocked(createImageBitmap)
  decode.mockRejectedValueOnce(new Error('The source image could not be decoded.'))
  decode.mockResolvedValueOnce(bitmap)
  const { root, pickFiles } = await mount()
  pickFiles(['坏图.png', '好图.png'].map((name) => new File([], name, { type: 'image/png' })))
  await flush()
  expect(root.querySelector('img[alt="坏图.png"]')).toBeNull()
  expect(root.textContent).toContain('坏图.png')
  expect(root.textContent).toContain('图片无法读取')
  expect(root.querySelector('img[alt="好图.png"]')).not.toBeNull()
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('图片的提取内容可框选识别范围，开始处理时随任务带上选区', async () => {
  const { root, pickFiles, config } = await mount()
  config.services.vision.apiKey = 'isolated-vision'
  pickFiles([new File([], '聊天.png', { type: 'image/png' }), new File([], '白板.png', { type: 'image/png' })])
  await flush()
  const extractMode = [...root.querySelectorAll<HTMLButtonElement>('.mode')].find(
    (button) => button.textContent?.trim() === '提取内容',
  )
  if (!extractMode) throw new Error('图片缺少提取内容模式')
  extractMode.click()
  await flush()
  const regions = root.querySelectorAll<HTMLButtonElement>('.thumb-region')
  expect(regions).toHaveLength(2)
  regions[0].click()
  await flush()
  const img = document.querySelector<HTMLImageElement>('.dialog .frame img')
  const stage = document.querySelector<HTMLElement>('.dialog .stage')
  if (!img || !stage) throw new Error('框选浮层没有打开')
  Object.defineProperties(stage, { clientWidth: { value: 600 }, clientHeight: { value: 500 } })
  Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  img.dispatchEvent(new Event('load'))
  await flush()
  const left = document.querySelector<HTMLButtonElement>('.dialog .handle.w')
  const done = document.querySelector<HTMLButtonElement>('.dialog .buttons button.primary')
  if (!left || !done) throw new Error('缺少框选控件')
  left.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  done.click()
  await flush()
  expect(root.querySelector('.thumb-region .region-mark')?.textContent).toBe('已框选')
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' }))
  await flush()
  const job = vi.mocked(runJob).mock.calls[0]?.[0]
  if (!job) throw new Error('没有开始处理')
  expect(job.mode).toBe('提取内容')
  expect(job.images?.[0].region).toEqual({ x: 10, y: 0, w: 390, h: 300 })
  expect(job.images?.[1].region).toBeNull()
})

it('连续导入按批次保序，坏图不占九张额度', async () => {
  const pending = deferred<ImageBitmap>()
  const decode = vi.mocked(createImageBitmap)
  decode.mockReturnValueOnce(pending.promise)
  const { root, pickFiles } = await mount()
  const files = (names: string[]) => names.map((name) => new File([], name, { type: 'image/png' }))
  pickFiles(files(['坏图.png', '首图.png']))
  pickFiles(files(Array.from({ length: 9 }, (_, i) => `追加-${i + 1}.png`)))
  expect(decode).toHaveBeenCalledTimes(1)
  pending.reject(new Error('无法解码'))
  await vi.waitFor(() => expect(root.querySelectorAll('.thumb img')).toHaveLength(9))
  expect([...root.querySelectorAll<HTMLImageElement>('.thumb img')].map((image) => image.alt)).toEqual([
    '首图.png',
    ...Array.from({ length: 8 }, (_, i) => `追加-${i + 1}.png`),
  ])
  expect(root.textContent).toContain('坏图.png')
  expect(root.textContent).toContain('追加-9.png')
})
it.each(['request', 'source', 'unchanged'] as const)('重新开始时按 %s 判断是否重用整理结果', async (change) => {
  const { root, pick } = await mount()
  pick('原文.txt')
  await flush()
  vi.mocked(runJob).mockImplementationOnce(async (job) => {
    job.chunkResults = { 0: 'skip' }
    job.chunkTotal = 2
    job.steps[0].status = 'done'
    const { AppError } = await import('../core/errors')
    throw new AppError('cancelled', '已取消')
  })
  root.querySelector<HTMLButtonElement>('.start')!.click()
  await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.start')?.disabled).toBe(false))
  if (change !== 'unchanged') {
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      change === 'request' ? 'textarea' : 'input[placeholder^="粘贴来源链接"]',
    )!
    input.value = change === 'request' ? '只保留结论' : 'https://example.com/source'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  }
  vi.mocked(runJob).mockImplementationOnce(async (job) => {
    expect(job.transcript).toBe('测试正文')
    expect(job.chunkResults).toEqual(change === 'unchanged' ? { 0: 'skip' } : undefined)
    expect(job.steps[0].status).toBe(change === 'unchanged' ? 'done' : 'pending')
    throw new Error('测试结束')
  })
  root.querySelector<HTMLButtonElement>('.start')!.click()
  await vi.waitFor(() => expect(vi.mocked(runJob)).toHaveBeenCalledTimes(2))
  await expect(vi.mocked(runJob).mock.results[1].value).rejects.toThrow('测试结束')
})

it('草稿恢复后返回修改仍保留图片框选范围', async () => {
  const { toDraft } = await import('../core/draft')
  const { newImageJob } = await import('../core/pipeline')
  const file = new File(['image'], '图.png', { type: 'image/png' })
  const region = { x: 4, y: 8, w: 60, h: 40 }
  const { data } = toDraft(newImageJob([{ file, region }], '提取内容'))
  vi.mocked(loadDraft).mockResolvedValueOnce({ data, files: { 'image-0': file } })
  const { root } = await mount()
  const click = (label: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)?.click()
  click('继续')
  await vi.waitFor(() => expect(root.textContent).toContain('返回修改'))
  click('返回修改')
  await flush()
  expect(root.querySelector('.region-mark')?.textContent).toBe('已框选')
})
