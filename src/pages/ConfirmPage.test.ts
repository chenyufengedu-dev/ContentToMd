// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, watch, type App } from 'vue'
import type { Editor } from '@tiptap/core'
import type * as TiptapVue from '@tiptap/vue-3'
import ConfirmPage, { type EditInfo } from './ConfirmPage.vue'
import { defaultConfig } from '../core/config'
import type { Job, JobImage } from '../core/pipeline'
import { parseNoteBody, type NoteImage } from '../core/note'
import { fromDraft, toDraft } from '../core/draft'
import type * as ImageTools from '../core/image'
import { cropForSave } from '../core/image'
import { saveNote, writeNote, writeAttachment, removeAttachment } from '../shell/tauri'

vi.mock('../core/image', async (original) => ({
  ...(await original<typeof ImageTools>()),
  cropForSave: vi.fn(),
}))

let editor: Editor | undefined
// 只捕获真实 useEditor 返回的实例，编辑/序列化/组件 DOM 均使用项目实际实现。
vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const actual = await importOriginal<typeof TiptapVue>()
  return {
    ...actual,
    useEditor: (options: Parameters<typeof actual.useEditor>[0]) => {
      const instance = actual.useEditor(options)
      watch(instance, (value) => (editor = value))
      return instance
    },
  }
})
vi.mock('../shell/tauri', () => ({
  saveNote: vi.fn(),
  writeNote: vi.fn(),
  writeAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  saveConfig: vi.fn(),
}))
let app: App
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:isolated')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.mocked(cropForSave).mockResolvedValue(new Blob(['cropped'], { type: 'image/png' }))
  vi.mocked(writeAttachment).mockResolvedValue('附件/2026-10/新裁剪.png')
  vi.mocked(removeAttachment).mockResolvedValue(undefined)
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  editor = undefined
  vi.unstubAllGlobals()
})
async function mount(body = '原始正文', editMode = true, pictures?: { files: JobImage[]; saved: NoteImage[] }) {
  const config = defaultConfig()
  const job: Job = {
    fileName: '旧标题.md',
    type: '文字',
    mode: '原文精修',
    steps: [],
    images: pictures?.files,
    draft: {
      title: '旧标题',
      domainId: 1,
      tags: [],
      keywords: [],
      summary: '',
      body,
      image_captions: [],
    },
  }
  const edit: EditInfo = {
    originalText: '打开时完整文件',
    path: '为人处世/旧标题.md',
    stem: '旧标题',
    meta: {
      domain: '为人处世',
      type: '文字',
      mode: '原文精修',
      source: '',
      platform: '',
      author: '',
      created: '2026-10-23',
      cover: pictures?.saved[0]?.path ?? '',
    },
    images: pictures?.saved ?? [],
    missing: 0,
    canOpen: false,
  }
  const dirty = vi.fn()
  const saved = vi.fn()
  const back = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(ConfirmPage, {
    config,
    job,
    existingTags: [],
    edit: editMode ? edit : undefined,
    onDirty: dirty,
    onSaved: saved,
    onBack: back,
  })
  app.mount(root)
  await nextTick()
  const titleField = root.querySelector<HTMLTextAreaElement>('textarea.title')
  const save = root.querySelector<HTMLButtonElement>('.action-row .btn-primary')
  if (!titleField || !save || !editor) throw new Error('确认页未就绪')
  const title = titleField
  const currentEditor = editor
  async function setTitle(value: string) {
    title.value = value
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  return { root, dirty, saved, back, save, setTitle, flush, editor: currentEditor, job }
}
async function cropFirst(root: HTMLElement) {
  const button = root.querySelector<HTMLButtonElement>('.pic-tools button')
  if (!button) throw new Error('编辑页没有裁剪入口')
  button.click()
  await nextTick()
  const img = document.querySelector<HTMLImageElement>('.dialog .frame img')
  const stage = document.querySelector<HTMLElement>('.dialog .stage')
  if (!img || !stage) throw new Error('裁剪弹窗没有打开')
  Object.defineProperties(stage, { clientWidth: { value: 600 }, clientHeight: { value: 500 } })
  Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  img.dispatchEvent(new Event('load'))
  await nextTick()
  const left = document.querySelector<HTMLButtonElement>('.dialog .handle.w')
  const done = document.querySelector<HTMLButtonElement>('.dialog .buttons button.primary')
  if (!left || !done) throw new Error('缺少裁剪控件')
  left.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  done.click()
  await nextTick()
}
function picture() {
  return {
    files: [{ file: new File(['original'], '原图.png', { type: 'image/png' }), noteImageIndex: 0 }],
    saved: [{ path: '../附件/原图.png', caption: '原始说明' }],
  }
}
it('编辑页仅裁剪图片也触发待保存，另存附件并同步正文与封面，原附件保留', async () => {
  const pictures = picture()
  const view = await mount('正文不变', true, pictures)
  await cropFirst(view.root)
  expect(view.save.disabled).toBe(false)
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  expect(cropForSave).toHaveBeenCalledWith(pictures.files[0].file, { x: 10, y: 0, w: 390, h: 300 })
  const content = vi.mocked(saveNote).mock.calls[0][4]
  expect(content).toContain('cover: "../附件/2026-10/新裁剪.png"')
  expect(content).toContain('![原始说明](../附件/2026-10/新裁剪.png)')
  expect(content).toContain('正文不变')
  expect(pictures.saved[0].path).toBe('../附件/原图.png')
  expect(removeAttachment).not.toHaveBeenCalled()
  expect(view.save.disabled).toBe(true)
})
it('编辑页裁剪后笔记保存失败，清理新副本并保留原引用和待保存状态', async () => {
  const pictures = picture()
  const view = await mount('正文', true, pictures)
  await cropFirst(view.root)
  vi.mocked(saveNote).mockRejectedValue(new Error('模拟保存失败'))
  view.save.click()
  await view.flush()
  expect(removeAttachment).toHaveBeenCalledWith('', '附件/2026-10/新裁剪.png')
  expect(removeAttachment).toHaveBeenCalledTimes(1)
  expect(pictures.saved[0].path).toBe('../附件/原图.png')
  expect(view.dirty).toHaveBeenLastCalledWith(true)
})
it('前面的图片缺失时，裁剪后面的图片不替换错引用或说明', async () => {
  const pictures = picture()
  pictures.saved.unshift({ path: '../附件/缺失.png', caption: '缺失说明' })
  pictures.files[0].noteImageIndex = 1
  const view = await mount('正文', true, pictures)
  await cropFirst(view.root)
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const content = vi.mocked(saveNote).mock.calls[0][4]
  expect(content).toContain('![缺失说明](../附件/缺失.png)')
  expect(content).toContain('![原始说明](../附件/2026-10/新裁剪.png)')
})
it('裁剪保存期间的新正文继续待保存，后续只改文字不重复写图片', async () => {
  const view = await mount('原始正文', true, picture())
  await cropFirst(view.root)
  let finish: (path: string) => void = () => {}
  vi.mocked(saveNote).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  view.save.click()
  await view.flush()
  view.editor.commands.insertContent('保存期间新正文')
  await nextTick()
  finish('为人处世/旧标题.md')
  await view.flush()
  expect(view.save.disabled).toBe(false)
  expect(vi.mocked(saveNote).mock.calls[0][4]).not.toContain('保存期间新正文')
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  expect(writeAttachment).toHaveBeenCalledTimes(1)
  expect(vi.mocked(saveNote).mock.calls[1][4]).toContain('![原始说明](../附件/2026-10/新裁剪.png)')
  expect(vi.mocked(saveNote).mock.calls[1][4]).toContain('保存期间新正文')
  expect(view.save.disabled).toBe(true)
})
it('本次编辑中裁剪保存后恢复原图，再保存使用原始文件而不是重复裁剪', async () => {
  const pictures = picture()
  const view = await mount('正文', true, pictures)
  await cropFirst(view.root)
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const restore = view.root.querySelector<HTMLButtonElement>('.pic-tools button:nth-child(2)')
  if (!restore) throw new Error('缺少恢复原图按钮')
  restore.click()
  await nextTick()
  expect(view.save.disabled).toBe(false)
  view.save.click()
  await view.flush()
  expect(cropForSave).toHaveBeenLastCalledWith(pictures.files[0].file, null)
  expect(writeAttachment).toHaveBeenCalledTimes(2)
  expect(view.save.disabled).toBe(true)
})
it('笔记保存只确认已提交的标题和正文，新编辑可继续保存', async () => {
  const view = await mount()
  await view.setTitle('提交标题')
  let finish: (path: string) => void = () => {}
  vi.mocked(saveNote).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  view.save.click()
  await view.setTitle('后续标题')
  view.editor.commands.insertContent('后续正文')
  await nextTick()
  finish('为人处世/提交标题.md')
  await view.flush()
  expect(saveNote).toHaveBeenCalledTimes(1)
  expect(vi.mocked(saveNote).mock.calls[0][4]).not.toContain('后续正文')
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  expect(view.save.disabled).toBe(false)
  vi.mocked(saveNote).mockResolvedValue('为人处世/后续标题.md')
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[1][3]).toBe('后续标题')
  expect(vi.mocked(saveNote).mock.calls[1][4]).toContain('后续正文')
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})
it.each([
  '```js\nconst answer = 42\n```\n\n[链接](https://example.invalid)',
  '| 名称 | 数值 |\n| --- | --- |\n| 测试 | 42 |\n\n正文中的 ![图](../附件/原图.png)',
  '第一段\n\n\n第二段  \n第三行',
])('只改属性时保留原始正文：%s', async (body) => {
  const view = await mount(body)
  vi.mocked(saveNote).mockResolvedValue('为人处世/新标题.md')
  await view.setTitle('新标题')
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain(body)
})
it('正文实际编辑后保存编辑结果', async () => {
  const body = '正文  \n第二行'
  const view = await mount(body)
  view.editor.commands.insertContent('新增')
  await nextTick()
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const first = vi.mocked(saveNote).mock.calls[0][4]
  expect(first).toContain('新增')
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})
it('首次保存时暂时暂停表单且只发布提交快照', async () => {
  const view = await mount('原始正文', false)
  let finish: (path: string) => void = () => {}
  vi.mocked(writeNote).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  view.save.click()
  await nextTick()
  expect(view.root.querySelector('main')?.hasAttribute('inert')).toBe(true)
  finish('为人处世/旧标题.md')
  await view.flush()
  expect(view.saved).toHaveBeenCalledWith(expect.objectContaining({ title: '旧标题', text: '原始正文' }))
})
it.each([
  '| 名称 | 数值 |\n| --- | --- |\n| 测试 | 42 |',
  '正文里的 ![图片](../附件/a.png)',
  '- [x] 已完成',
  '<table><tr><td>内容</td></tr></table>',
])('特殊格式保留原文并限制不安全的正文编辑，属性仍可修改：%s', async (body) => {
  const view = await mount(body)
  expect(view.editor.isEditable).toBe(false)
  expect(view.root.querySelector('.body-raw')?.textContent).toBe(body)
  expect(view.root.textContent).toContain('正文含暂不支持的格式')
  await view.setTitle('安全修改属性')
  expect(view.save.disabled).toBe(false)
})
it('撤销正文到初始状态后，属性保存仍使用原文', async () => {
  const body = '第一段\n\n\n第二段'
  const view = await mount(body)
  view.editor.commands.insertContent('新增')
  view.editor.commands.undo()
  await view.setTitle('只改标题')
  vi.mocked(saveNote).mockResolvedValue('为人处世/只改标题.md')
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain(body)
})
it('保存失败后保留修改并可重新保存', async () => {
  const view = await mount()
  await view.setTitle('未保存标题')
  vi.mocked(saveNote).mockRejectedValueOnce(new Error('测试写入失败'))
  view.save.click()
  await view.flush()
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  expect(view.root.textContent).toContain('没有保存')
  const retry = [...view.root.querySelectorAll('button')].find((button) => button.textContent?.trim() === '重新保存')
  if (!retry) throw new Error('缺少重新保存入口')
  vi.mocked(saveNote).mockResolvedValue('为人处世/未保存标题.md')
  retry.click()
  await view.flush()
  expect(saveNote).toHaveBeenCalledTimes(2)
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})

it('笔记编辑页 Esc 与返回按钮发出同一个返回事件', async () => {
  const view = await mount()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect(view.back).toHaveBeenCalledTimes(1)
  const backButton = view.root.querySelector<HTMLButtonElement>('button.back')
  if (!backButton) throw new Error('缺少返回按钮')
  backButton.click()
  expect(view.back).toHaveBeenCalledTimes(2)
})
it('新增确认页 Esc 不触发笔记返回', async () => {
  const view = await mount('原始正文', false)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect(view.back).not.toHaveBeenCalled()
})
it('编辑页提示框打开时 Esc 只关闭提示，再按才返回', async () => {
  const view = await mount()
  await view.setTitle('未保存')
  vi.mocked(saveNote).mockRejectedValueOnce(new Error('测试失败'))
  view.save.click()
  await view.flush()
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!dialog) throw new Error('缺少保存失败提示')
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await nextTick()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(view.back).not.toHaveBeenCalled()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect(view.back).toHaveBeenCalledTimes(1)
})

it('编辑保存携带打开时的完整文件，成功后下一次使用已提交内容作为基线', async () => {
  const view = await mount()
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  await view.setTitle('第一次')
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[0][5]).toBe('打开时完整文件')
  const first = vi.mocked(saveNote).mock.calls[0][4]
  await view.setTitle('第二次')
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[1][5]).toBe(first)
})
it('外部修改冲突不清除本地待保存状态，也不更新文件基线', async () => {
  const view = await mount()
  await view.setTitle('本地修改')
  vi.mocked(saveNote).mockRejectedValue(new Error('这条笔记已被其他程序修改，未覆盖文件'))
  view.save.click()
  await view.flush()
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  expect(view.root.textContent).toContain('先复制')
  const retry = [...view.root.querySelectorAll('button')].find((button) => button.textContent?.trim() === '重新保存')
  if (!retry) throw new Error('缺少保存失败入口')
  retry.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[1][5]).toBe('打开时完整文件')
})

it('显示宽度调整、保存和恢复默认不重写附件或改变封面', async () => {
  const view = await mount('正文', true, picture())
  const image = view.root.querySelector<HTMLImageElement>('.pic-crop img')!
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  image.dispatchEvent(new Event('load'))
  await nextTick()
  const figure = view.root.querySelector<HTMLElement>('.pic')!
  const host = view.root.querySelector<HTMLElement>('.pics')!
  vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect)
  Object.defineProperty(host, 'clientWidth', { value: 600 })
  const handle = view.root.querySelector<HTMLButtonElement>('[aria-label="调整图片大小"]')
  expect(handle).not.toBeNull()
  handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await nextTick()
  expect(figure.style.width).toBe('min(100%, 330px)')
  expect(view.save.disabled).toBe(false)
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const content = vi.mocked(saveNote).mock.calls[0][4]
  expect(content).toContain('![原始说明|330](../附件/原图.png)')
  expect(content).toContain('cover: "../附件/原图.png"')
  expect(writeAttachment).not.toHaveBeenCalled()
  expect(cropForSave).not.toHaveBeenCalled()
  expect(view.save.disabled).toBe(true)
  const reset = [...view.root.querySelectorAll<HTMLButtonElement>('.pic-tools button')].find(
    (button) => button.textContent?.trim() === '恢复',
  )!
  reset.click()
  await nextTick()
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[1][4]).toContain('![原始说明](../附件/原图.png)')
  expect(writeAttachment).not.toHaveBeenCalled()
})

it('新笔记拖动限制在正文宽度内，取消拖动还原，保存带上显示宽度', async () => {
  const pictures = picture()
  const view = await mount('正文', false, pictures)
  const image = view.root.querySelector<HTMLImageElement>('.pic-crop img')!
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  image.dispatchEvent(new Event('load'))
  await nextTick()
  const figure = view.root.querySelector<HTMLElement>('.pic')!
  const host = view.root.querySelector<HTMLElement>('.pics')!
  Object.defineProperty(host, 'clientWidth', { value: 600 })
  vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect)
  const handle = view.root.querySelector<HTMLButtonElement>('[aria-label="调整图片大小"]')!
  handle.setPointerCapture = vi.fn()
  function pointer(type: string, clientX: number, clientY = 0) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      button: { value: 0 },
      clientX: { value: clientX },
      clientY: { value: clientY },
    })
    handle.dispatchEvent(event)
  }
  pointer('pointerdown', 320)
  pointer('pointermove', 1000)
  await nextTick()
  expect(figure.style.width).toBe('min(100%, 600px)')
  expect(figure.querySelector<HTMLElement>('.pic-crop')!.style.aspectRatio).toBe('400 / 300')
  pointer('pointermove', -1000)
  await nextTick()
  expect(figure.style.width).toBe('min(100%, 96px)')
  pointer('pointercancel', -1000)
  await nextTick()
  expect(view.job.images![0].width).toBeUndefined()
  pointer('pointerdown', 320)
  pointer('pointermove', 320, 60)
  pointer('pointerup', 320, 60)
  await nextTick()
  vi.mocked(writeNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  expect(vi.mocked(writeNote).mock.calls[0][4]).toContain('![|400](../附件/2026-10/新裁剪.png)')
  expect(cropForSave).toHaveBeenCalledWith(pictures.files[0].file, null)
  expect(writeAttachment).toHaveBeenCalledTimes(1)
})

it('裁剪与尺寸都修改后只显示一个恢复入口，一次恢复两项', async () => {
  const pictures = picture()
  const view = await mount('正文', true, { ...pictures, files: [{ ...pictures.files[0], width: 160 }] })
  await cropFirst(view.root)
  const buttons = [...view.root.querySelectorAll<HTMLButtonElement>('.pic-tools button')]
  expect(buttons.map((button) => button.textContent?.trim())).toEqual(['调整裁剪', '恢复'])
  expect(buttons[1].title).toBe('恢复原图和默认大小')
  buttons[1].click()
  await nextTick()
  expect(view.job.images![0].crop).toBeNull()
  expect(view.job.images![0].width).toBeUndefined()
})

it('导入页调整尺寸后草稿恢复、笔记保存并重新打开均保留宽度和封面引用', async () => {
  const pictures = picture()
  const view = await mount('正文保留', false, pictures)
  const image = view.root.querySelector<HTMLImageElement>('.pic-crop img')!
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  image.dispatchEvent(new Event('load'))
  await nextTick()
  const figure = view.root.querySelector<HTMLElement>('.pic')!
  Object.defineProperty(figure.parentElement, 'clientWidth', { value: 600 })
  vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect)
  view.root
    .querySelector<HTMLButtonElement>('[aria-label="调整图片大小"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await nextTick()
  const draft = toDraft(view.job)
  const restored = fromDraft(JSON.parse(JSON.stringify(draft.data)), { 'image-0': pictures.files[0].file })
  expect(restored.job.images![0].width).toBe(330)
  vi.mocked(writeNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const markdown = vi.mocked(writeNote).mock.calls[0][4]
  expect(markdown).toContain('cover: "../附件/2026-10/新裁剪.png"')
  const parsed = parseNoteBody(markdown.split('\n---\n')[1])
  expect(parsed.images).toEqual([{ path: '../附件/2026-10/新裁剪.png', caption: '', width: 330 }])
  app.unmount()
  const reopened = await mount(parsed.body, true, {
    files: [{ file: pictures.files[0].file, noteImageIndex: 0, width: parsed.images[0].width }],
    saved: parsed.images,
  })
  const reopenedImage = reopened.root.querySelector<HTMLImageElement>('.pic-crop img')!
  Object.defineProperties(reopenedImage, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  reopenedImage.dispatchEvent(new Event('load'))
  await nextTick()
  expect(reopened.root.querySelector<HTMLElement>('.pic')!.style.width).toBe('min(100%, 330px)')
  expect(reopened.save.disabled).toBe(true)
  await reopened.setTitle('只改标题')
  vi.mocked(saveNote).mockResolvedValue('为人处世/只改标题.md')
  reopened.save.click()
  await reopened.flush()
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain('![|330](../附件/2026-10/新裁剪.png)')
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain('cover: "../附件/2026-10/新裁剪.png"')
  expect(writeAttachment).toHaveBeenCalledTimes(1)
})
