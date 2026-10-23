// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { useCover } from './useCover'
import { makeThumbs } from '../core/thumbs'
import { readCover } from '../shell/tauri'
import type { LibraryNote } from '../core/library'
vi.mock('../core/thumbs', () => ({ makeThumbs: vi.fn() }))
vi.mock('../shell/tauri', () => ({ readCover: vi.fn() }))
let app: App | undefined
let intersect: () => void
let decode: () => Promise<void>
const revoked = vi.fn()
const created = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  let seq = 0
  created.mockImplementation(() => `blob:${++seq}`)
  vi.stubGlobal('URL', { createObjectURL: created, revokeObjectURL: revoked })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = () => callback([{ isIntersecting: true }])
      }
      observe() {}
      disconnect() {}
    },
  )
  decode = () => Promise.resolve()
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode() {
        return decode()
      }
    },
  )
  vi.mocked(readCover).mockResolvedValue(new Blob(['image']))
  vi.mocked(makeThumbs).mockResolvedValue({ thumb: new Blob(['thumb']), blurred: new Blob(['blur']) })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
async function flush() {
  for (let i = 0; i < 8; i++) await nextTick()
}
function mount(visible = true) {
  const note = ref<LibraryNote>({
    path: '领域/a.md',
    title: 'a',
    domain: '领域',
    created: '',
    tags: [],
    keywords: [],
    cover: '附件/a.png',
    body: '',
  })
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    setup() {
      const el = ref<HTMLElement>()
      const cover = useCover(
        el,
        () => note.value,
        () => '隔离库',
      )
      return () => h('div', { ref: el }, cover.thumbUrl.value)
    },
  })
  app.mount(root)
  if (visible) intersect()
  return { note, root }
}
it('解码失败时释放已创建的两张预览', async () => {
  decode = () => Promise.reject(new Error('坏图'))
  const { root } = mount()
  await flush()
  expect(root.textContent).toBe('')
  expect(revoked.mock.calls.map((c) => c[0])).toEqual(['blob:1', 'blob:2'])
})
it('卸载后迟到的缩略图不创建预览资源', async () => {
  let finish: (v: Awaited<ReturnType<typeof makeThumbs>>) => void = () => {}
  vi.mocked(makeThumbs).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  mount()
  await flush()
  app?.unmount()
  app = undefined
  finish({ thumb: new Blob(), blurred: new Blob() })
  await flush()
  expect(created).not.toHaveBeenCalled()
})
it('卸载时释放解码中的预览，迟到结果不再显示或重复释放', async () => {
  let finish = () => {}
  const wait = new Promise<void>((resolve) => (finish = resolve))
  decode = () => wait
  mount()
  await flush()
  app?.unmount()
  app = undefined
  expect(revoked).toHaveBeenCalledTimes(2)
  finish()
  await flush()
  expect(revoked).toHaveBeenCalledTimes(2)
})
it('封面变更释放旧资源，新的预览替换；重复可见回调不重复读取', async () => {
  const { note, root } = mount()
  await flush()
  expect(root.textContent).toBe('blob:1')
  intersect()
  await flush()
  expect(readCover).toHaveBeenCalledTimes(1)
  note.value.cover = '附件/b.png'
  await flush()
  expect(root.textContent).toBe('blob:3')
  expect(revoked.mock.calls.map((c) => c[0])).toEqual(['blob:1', 'blob:2'])
})
it('创建第二张预览失败时仍释放第一张，后续卸载不重复释放', async () => {
  created
    .mockImplementationOnce(() => 'blob:only')
    .mockImplementationOnce(() => {
      throw new Error('资源创建失败')
    })
  mount()
  await flush()
  expect(revoked.mock.calls.map((c) => c[0])).toEqual(['blob:only'])
})
it('旧封面读取迟到不能覆盖新封面或生成多余缩略图', async () => {
  let finish: (blob: Blob) => void = () => {}
  vi.mocked(readCover).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  const { note, root } = mount()
  await flush()
  note.value.cover = '附件/new.png'
  await flush()
  expect(root.textContent).toBe('blob:1')
  finish(new Blob(['old']))
  await flush()
  expect(makeThumbs).toHaveBeenCalledTimes(1)
  expect(root.textContent).toBe('blob:1')
})
it('未进入视野就卸载时，迟到的可见回调不能启动读取', async () => {
  mount(false)
  app?.unmount()
  app = undefined
  intersect()
  await flush()
  expect(readCover).not.toHaveBeenCalled()
})
