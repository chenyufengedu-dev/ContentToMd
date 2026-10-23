// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, watch, type App } from 'vue'
import type { Editor } from '@tiptap/core'
import type * as TiptapVue from '@tiptap/vue-3'
import ConfirmPage, { type EditInfo } from './ConfirmPage.vue'
import { defaultConfig } from '../core/config'
import type { Job } from '../core/pipeline'
import { saveNote, writeNote } from '../shell/tauri'

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
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  editor = undefined
  vi.unstubAllGlobals()
})
async function mount(body = '原始正文', editMode = true) {
  const config = defaultConfig()
  const job: Job = {
    fileName: '旧标题.md',
    type: '文字',
    mode: '原文精修',
    steps: [],
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
      cover: '',
    },
    images: [],
    missing: 0,
    canOpen: false,
  }
  const dirty = vi.fn()
  const saved = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(ConfirmPage, {
    config,
    job,
    existingTags: [],
    edit: editMode ? edit : undefined,
    onDirty: dirty,
    onSaved: saved,
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
  return { root, dirty, saved, save, setTitle, flush, editor: currentEditor, job }
}
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
