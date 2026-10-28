// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, watch, type App } from 'vue'
import type { Editor } from '@tiptap/core'
import type * as TiptapVue from '@tiptap/vue-3'
import ConfirmPage, { type EditInfo } from './ConfirmPage.vue'
import { defaultConfig } from '../core/config'
import type { Job, JobImage } from '../core/pipeline'
import { parseNoteBody, type NoteImage } from '../core/note'
import { fromDraft, toDraft } from '../core/draft'
import type * as ImageTools from '../core/image'
import { cropForSave } from '../core/image'
import {
  saveEditRecovery,
  clearEditRecovery,
  saveNote,
  writeNote,
  writeAttachment,
  removeAttachment,
  saveConfig,
} from '../shell/tauri'
import type { NoteRecovery } from '../core/noteRecovery'

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
  saveEditRecovery: vi.fn().mockResolvedValue(undefined),
  clearEditRecovery: vi.fn().mockResolvedValue(undefined),
  saveNote: vi.fn(),
  writeNote: vi.fn(),
  writeAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  saveConfig: vi.fn(),
}))
let app: App
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(saveEditRecovery).mockResolvedValue(undefined)
  vi.mocked(clearEditRecovery).mockResolvedValue(undefined)
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
async function mount(
  body = '原始正文',
  editMode = true,
  pictures?: { files: JobImage[]; saved: NoteImage[] },
  recovery?: NoteRecovery,
  suggestion?: string,
) {
  const config = reactive(defaultConfig())
  config.domains.unshift({ id: 1, name: '为人处世' })
  const job: Job = {
    fileName: '旧标题.md',
    type: '文字',
    mode: '原文精修',
    steps: [],
    images: pictures?.files,
    draft: {
      title: '旧标题',
      domainId: suggestion ? 99 : 1,
      suggestedDomain: suggestion,
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
  const edited = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const componentProps = {
    config,
    job,
    existingTags: [],
    edit: editMode ? edit : undefined,
    recovery,
    onDirty: dirty,
    onSaved: saved,
    onBack: back,
    onEdited: edited,
    onConfigChanged: (next: typeof config) => Object.assign(config, next),
  }
  let controller: InstanceType<typeof ConfirmPage> | null = null
  app = createApp({
    render: () =>
      h(ConfirmPage, {
        ...componentProps,
        ref: (instance) => {
          controller = instance as InstanceType<typeof ConfirmPage> | null
        },
      }),
  })
  // Vue 的实例通过 defineExpose 暴露恢复副本的明确放弃入口。
  app.mount(root)
  await nextTick()
  const titleField = root.querySelector<HTMLTextAreaElement>('textarea.title')
  const save = root.querySelector<HTMLButtonElement>('.action-row .btn-primary')
  if (!titleField || !save || !editor) throw new Error('确认页未就绪')
  const title = titleField
  const currentEditor = editor
  // jsdom没有选区布局，焦点/滚动的可视结果用浏览器验证。
  currentEditor.setOptions({ editorProps: { handleScrollToSelection: () => true } })
  async function setTitle(value: string) {
    title.value = value
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  return {
    root,
    dirty,
    saved,
    back,
    edited,
    save,
    setTitle,
    flush,
    editor: currentEditor,
    job,
    config,
    discardRecovery: () => {
      if (!controller) throw new Error('确认页已卸载')
      return controller.discardRecovery()
    },
  }
}
it('建议新领域复用新增入口，确认后更新领域列表和本笔记选择', async () => {
  const view = await mount('正文', false, undefined, undefined, '摄影技巧')
  const row = view.root.querySelector('.domain-suggestion')
  expect(row?.textContent).toContain('建议新建：摄影技巧')
  const create = row?.querySelector('button')
  if (!create) throw new Error('缺少新建入口')
  expect(view.job.draft?.domainId).toBe(99)
  create.click()
  await view.flush()
  const name = view.root.querySelector<HTMLInputElement>('[aria-label="新领域的名字"]')
  expect(name?.value).toBe('摄影技巧')
  const confirm = [...view.root.querySelectorAll<HTMLButtonElement>('.dialog button')].find(
    (b) => b.textContent === '新增并选择',
  )
  if (!confirm) throw new Error('缺少创建确认按钮')
  vi.mocked(saveConfig).mockResolvedValue(undefined)
  confirm.click()
  await view.flush()
  expect(saveConfig).toHaveBeenCalledTimes(1)
  expect(view.config.domains.map((d) => d.name)).toEqual(['为人处世', '摄影技巧', '其他'])
  expect(view.root.querySelector('[aria-label="领域"]')?.textContent).toContain('摄影技巧')
  expect(view.root.querySelector('.domain-suggestion')).toBeNull()
})
it.each(['其他', '为人处世', '设计/UI', '字'])('确认页不显示不合规或重名建议：%s', async (suggestion) => {
  const view = await mount('正文', false, undefined, undefined, suggestion)
  expect(view.root.querySelector('.domain-suggestion')).toBeNull()
})
it('已有笔记页不显示领域建议', async () => {
  const view = await mount('正文', true, undefined, undefined, '摄影技巧')
  expect(view.root.querySelector('.domain-suggestion')).toBeNull()
})
it('已有笔记停顿后仅保存恢复副本，重开恢复后仍须主动保存', async () => {
  const first = await mount()
  await first.setTitle('恢复标题')
  first.editor.commands.insertContent('未保存正文')
  await new Promise((resolve) => setTimeout(resolve, 850))
  const record = vi.mocked(saveEditRecovery).mock.calls.at(-1)?.[0]
  if (!record) throw new Error('未保存恢复副本')
  expect(record.originalText).toBe('打开时完整文件')
  expect(record.draft.title).toBe('恢复标题')
  expect(record.draft.body).toContain('未保存正文')
  expect(saveNote).not.toHaveBeenCalled()
  app.unmount()
  const restored = await mount('原始正文', true, undefined, record)
  await restored.flush()
  expect(restored.editor.getText()).toContain('未保存正文')
  expect(restored.save.disabled).toBe(false)
  expect(saveNote).not.toHaveBeenCalled()
  vi.mocked(saveNote).mockResolvedValue('为人处世/恢复标题.md')
  restored.save.click()
  await restored.flush()
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain('未保存正文')
  expect(clearEditRecovery).toHaveBeenCalledWith(expect.any(String), record.path)
})
it('恢复正文仍使用旧读取基线，外部改动冲突不清除恢复内容', async () => {
  const record: NoteRecovery = {
    version: 1,
    root: '',
    path: '为人处世/旧标题.md',
    savedAt: 1,
    originalText: '更早的文件',
    draft: {
      title: '旧标题',
      domainId: 1,
      tags: ['恢复标签'],
      keywords: [],
      summary: '',
      body: '恢复的修改',
      image_captions: [],
    },
    images: [],
  }
  const view = await mount('别处修改的新正文', true, undefined, record)
  await view.flush()
  vi.mocked(saveNote).mockRejectedValueOnce(new Error('笔记已在别处修改，请重新打开'))
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[0][5]).toBe('更早的文件')
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  expect(view.editor.getText()).toBe('恢复的修改')
})
it('恢复副本写入失败会提示，正式笔记不被自动修改', async () => {
  vi.mocked(saveEditRecovery).mockRejectedValueOnce(new Error('隔离磁盘满'))
  const view = await mount()
  await view.setTitle('等待恢复')
  await new Promise((resolve) => setTimeout(resolve, 850))
  await nextTick()
  expect(view.root.textContent).toContain('本地恢复副本未能更新')
  expect(view.save.disabled).toBe(false)
  expect(saveNote).not.toHaveBeenCalled()
})
it('明确放弃会取消尚未落盘的定时写入，之后不复活恢复副本', async () => {
  const view = await mount()
  await view.setTitle('即将放弃')
  expect(await view.discardRecovery()).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 850))
  expect(clearEditRecovery).toHaveBeenCalled()
  expect(saveEditRecovery).not.toHaveBeenCalled()
  expect(saveNote).not.toHaveBeenCalled()
})
it('持续输入也定期保留检查点，不会一直等待停止输入', async () => {
  vi.useFakeTimers()
  try {
    const view = await mount()
    for (let i = 0; i < 6; i++) {
      await view.setTitle(`连续修改${i}`)
      await vi.advanceTimersByTimeAsync(150)
    }
    expect(saveEditRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ title: '连续修改5' }) }),
    )
    expect(saveNote).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
it('恢复上次已保存裁剪后的“恢复原图”操作仍是待保存，并从源图保存', async () => {
  const images = picture()
  const record: NoteRecovery = {
    version: 1,
    root: '',
    path: '为人处世/旧标题.md',
    savedAt: 1,
    originalText: '打开时完整文件',
    draft: { title: '旧标题', domainId: 1, tags: [], keywords: [], summary: '', body: '正文', image_captions: [] },
    images: [{ index: 0, source: images.saved[0].path, savedCrop: { x: 10, y: 10, w: 80, h: 60 }, crop: null }],
  }
  const view = await mount(
    '正文',
    true,
    { files: images.files, saved: [{ ...images.saved[0], path: '../附件/已保存裁剪.png' }] },
    record,
  )
  expect(view.save.disabled).toBe(false)
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  expect(cropForSave).toHaveBeenCalledWith(images.files[0].file, null)
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain('新裁剪.png')
})
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
it.each(['> 引用结尾', '第一段\n\n---', '- 列表结尾', '| 名称 |\n| --- |\n| 数据 |'])(
  '仅移动光标或聚焦不产生待保存，随后只改属性仍保留原正文：%s',
  async (body) => {
    const view = await mount(body)
    // jsdom 不提供选区布局；滚动交由真实浏览器验收。
    view.editor.setOptions({ editorProps: { handleScrollToSelection: () => true } })
    expect(view.save.disabled).toBe(true)
    view.editor.commands.setTextSelection(2)
    view.editor.commands.focus(undefined, { scrollIntoView: false })
    await view.flush()
    expect(view.save.disabled).toBe(true)
    expect(view.dirty).not.toHaveBeenCalledWith(true)
    expect(view.editor.can().undo()).toBe(false)
    view.editor.commands.insertContent('真实修改')
    await nextTick()
    expect(view.save.disabled).toBe(false)
    view.editor.commands.undo()
    await nextTick()
    expect(view.save.disabled).toBe(true)
    await view.setTitle('仅改标题')
    vi.mocked(saveNote).mockResolvedValue('为人处世/仅改标题.md')
    view.save.click()
    await view.flush()
    expect(vi.mocked(saveNote).mock.calls[0][4]).toContain(body)
  },
)
it('粘贴多段、表格和代码后可撤销重做，保存内容保留数字与例外', async () => {
  const view = await mount('原始正文')
  const original = view.editor.getMarkdown()
  view.editor.commands.selectAll()
  const paste = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(paste, 'clipboardData', {
    value: {
      types: ['text/html', 'text/plain'],
      files: [],
      getData: (type: string) =>
        type === 'text/html'
          ? '<p>中文第一段，报销上限 1200 元。</p><p>例外：实习生不适用。</p><table><tr><th>项目</th><th>金额</th></tr><tr><td>交通</td><td>80.50</td></tr></table><blockquote><p>先审批，再出发。</p></blockquote><pre><code class="language-js">const limit = 1200</code></pre>'
          : type === 'text/plain'
            ? '中文第一段，报销上限 1200 元。\n例外：实习生不适用。'
            : '',
    },
  })
  view.editor.view.dom.dispatchEvent(paste)
  await nextTick()
  expect(paste.defaultPrevented).toBe(true)
  const pasted = view.editor.getMarkdown()
  for (const value of ['1200', '80.50', '实习生不适用', '先审批，再出发', 'const limit = 1200'])
    expect(pasted).toContain(value)
  expect(view.editor.getHTML()).toContain('<table')
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  view.editor.commands.undo()
  await nextTick()
  expect(view.editor.getMarkdown()).toBe(original)
  expect(view.dirty).toHaveBeenLastCalledWith(false)
  view.editor.commands.redo()
  await nextTick()
  expect(view.editor.getMarkdown()).toBe(pasted)
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  vi.mocked(saveNote).mockResolvedValueOnce('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  const submitted = vi.mocked(saveNote).mock.calls[0]
  expect(submitted[4]).toContain('80.50')
  expect(submitted[4]).toContain('实习生不适用')
  expect(view.dirty).toHaveBeenLastCalledWith(false)
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
it.each(['正文里的 ![图片](../附件/a.png)', '<table><tr><td>内容</td></tr></table>'])(
  '暂不支持格式进入可编辑源码，保存保留完整格式：%s',
  async (body) => {
    const view = await mount(body)
    expect(view.editor.isEditable).toBe(false)
    const source = view.root.querySelector<HTMLTextAreaElement>('textarea.body-raw')
    if (!source) throw new Error('缺少源码编辑框')
    expect(source.value).toBe(body)
    source.value = `${body}\n\n新增正文`
    source.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(view.dirty).toHaveBeenLastCalledWith(true)
    expect(view.save.disabled).toBe(false)
    vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
    view.save.click()
    await view.flush()
    expect(vi.mocked(saveNote).mock.calls[0][4]).toContain(`${body}\n\n新增正文`)
    expect(view.dirty).toHaveBeenLastCalledWith(false)
  },
)
it.each([true, false])('表格与任务可直接编辑并保存，已有笔记=%s', async (edit) => {
  const body = '| 名称 | 数值 |\n| --- | --- |\n| 测试 | 42 |\n\n- [x] 已完成'
  const view = await mount(body, edit)
  expect(view.editor.isEditable).toBe(true)
  expect(view.root.querySelector('.body-raw')).toBeNull()
  expect(view.root.querySelector('.body table')).not.toBeNull()
  view.editor.commands.insertContent('新增正文')
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  vi.mocked(writeNote).mockResolvedValue('为人处世/旧标题.md')
  await nextTick()
  view.save.click()
  await view.flush()
  const md = edit ? vi.mocked(saveNote).mock.calls[0][4] : vi.mocked(writeNote).mock.calls[0][4]
  expect(md).toContain('新增正文')
  expect(md).toContain('42')
  expect(md).toContain('- [x] 已完成')
})
it('导入结果的源码修改进入草稿并用于首次保存及成功页内容', async () => {
  const body = '正文 ![图](附件/a.png)\n\n<div>保留 HTML</div>'
  const view = await mount(body, false)
  const source = view.root.querySelector<HTMLTextAreaElement>('textarea.body-raw')
  if (!source) throw new Error('缺少源码编辑框')
  const changed = `${body}\n\n源码修改`
  source.value = changed
  source.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 850))
  expect(view.edited).toHaveBeenCalledWith(expect.objectContaining({ body: changed }))
  vi.mocked(writeNote).mockResolvedValue('为人处世/旧标题.md')
  view.save.click()
  await view.flush()
  expect(vi.mocked(writeNote).mock.calls[0][4]).toContain(changed)
  expect(view.saved).toHaveBeenCalledWith(expect.objectContaining({ text: changed }))
})
it('表格工具只在单元格中出现，可增删行列且修改单元格后保存内容完整', async () => {
  const view = await mount('| 名称 | 数值 |\n| --- | --- |\n| 测试 | 42 |')
  let cell = -1
  view.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === '测试') cell = pos
  })
  expect(cell).toBeGreaterThan(0)
  view.editor.commands.setTextSelection({ from: cell, to: cell + 2 })
  view.editor.commands.insertContent('改过')
  await nextTick()
  const group = view.root.querySelector('[aria-label="表格操作"]')
  if (!group) throw new Error('缺少表格操作')
  for (const label of ['插入行', '删除行', '插入列', '删除列']) {
    if (label === '删除行' || label === '删除列') {
      let empty = -1
      const type = label === '删除行' ? 'tableRow' : 'tableHeader'
      view.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === type && node.textContent === '') empty = pos
      })
      expect(empty).toBeGreaterThan(0)
      view.editor.commands.setTextSelection(empty + (label === '删除行' ? 3 : 2))
    }
    const button = [...group.querySelectorAll('button')].find((b) => b.textContent === label)
    if (!button) throw new Error(`缺少${label}`)
    button.click()
    await nextTick()
  }
  expect(view.editor.getMarkdown()).toContain('42')
  expect(view.editor.getMarkdown()).toContain('改过')
  vi.mocked(saveNote).mockResolvedValue('为人处世/旧标题.md')
  await nextTick()
  view.save.click()
  await view.flush()
  expect(vi.mocked(saveNote).mock.calls[0][4]).toContain('改过')
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
  expect(view.root.textContent).toContain('保存失败')
  const retry = [...view.root.querySelectorAll('button')].find((button) => button.textContent?.trim() === '重新保存')
  if (!retry) throw new Error('缺少重新保存入口')
  vi.mocked(saveNote).mockResolvedValue('为人处世/未保存标题.md')
  retry.click()
  await view.flush()
  expect(saveNote).toHaveBeenCalledTimes(2)
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})

it('收藏库丢失时保存失败提示只显示一次设置入口，继续编辑不丢失修改', async () => {
  const view = await mount()
  await view.setTitle('未保存标题')
  vi.mocked(saveNote).mockRejectedValueOnce(new Error('收藏库文件夹“D:\\临时测试库”找不到了，请重新选择'))
  view.save.click()
  await view.flush()
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!dialog) throw new Error('缺少保存失败提示')
  expect([...dialog.querySelectorAll('p')].map((p) => p.textContent?.trim())).toContain(
    '请到设置重新选择，再尝试保存。当前修改仍保留。',
  )
  expect(dialog.querySelectorAll('button.link')).toHaveLength(1)
  const keep = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '继续编辑')
  if (!keep) throw new Error('缺少继续编辑入口')
  keep.click()
  await nextTick()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  expect(saveNote).toHaveBeenCalledTimes(1)
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
  expect(buttons[1].title).toBe('恢复原图和默认尺寸')
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
