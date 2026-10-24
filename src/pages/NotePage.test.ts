// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type FunctionalComponent } from 'vue'
import NotePage from './NotePage.vue'
import { defaultConfig, type Config } from '../core/config'
import { parseNoteFile } from '../core/note'
import { readNote, readCover, guardClose } from '../shell/tauri'
import type { Job } from '../core/pipeline'
import type { EditInfo } from './ConfirmPage.vue'

vi.mock('../shell/tauri', () => ({
  readNote: vi.fn(),
  listVaultTags: vi.fn().mockResolvedValue([]),
  guardClose: vi.fn().mockResolvedValue((): void => {}),
  deleteNote: vi.fn(),
  destroyWindow: vi.fn(),
  openNote: vi.fn(),
  readCover: vi.fn(),
}))
vi.mock('./ConfirmPage.vue', () => {
  const editor: FunctionalComponent<{ config: Config; job: Job; edit: EditInfo }> = (props, { emit }) =>
    h('div', [
      h(
        'button',
        {
          'data-image-index': props.job.images?.[0]?.noteImageIndex,
          'data-image-width': props.job.images?.[0]?.width,
          'data-original-text': props.edit.originalText,
          onClick: () =>
            emit('configChanged', {
              ...props.config,
              domains: [...props.config.domains, { id: 100, name: '新领域' }],
            }),
        },
        props.config.domains.map((d) => d.name).join(','),
      ),
      h('button', { class: 'test-back', onClick: () => emit('back') }, '返回'),
      h('button', { class: 'test-edit', onClick: () => emit('dirty', true) }, '修改'),
    ])
  editor.props = ['config', 'job', 'edit']
  editor.emits = ['configChanged', 'back', 'dirty']
  return { default: editor }
})
it('跳过缺失图片时，保留后续加载图片在笔记中的原始索引', async () => {
  vi.mocked(readNote).mockResolvedValue(
    parseNoteFile({
      originalText: '打开时完整文件',
      title: '测试',
      stem: '测试',
      domain: '为人处世',
      content: '![缺失](../附件/缺失.png)\n\n![正常|330](../附件/正常.png)\n\n正文',
    }),
  )
  vi.mocked(readCover)
    .mockRejectedValueOnce(new Error('缺失'))
    .mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  const root = await mountNote('为人处世/测试.md')
  expect(root.querySelector('button')?.getAttribute('data-image-index')).toBe('1')
  expect(root.querySelector('button')?.getAttribute('data-image-width')).toBe('330')
  expect(root.querySelector('button')?.getAttribute('data-original-text')).toBe('打开时完整文件')
})
let app: App | undefined
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
async function mountNote(path: string, onConfigChanged: (c: Config) => void = vi.fn(), onBack = vi.fn()) {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(NotePage, { config: defaultConfig(), path, onConfigChanged, onBack })
  app.mount(root)
  for (let i = 0; i < 8; i++) await nextTick()
  return root
}
it('笔记编辑页更新领域时同时更新当前编辑器并通知应用层', async () => {
  vi.mocked(readNote).mockResolvedValue(
    parseNoteFile({
      originalText: '打开时完整文件',
      title: '测试笔记',
      stem: '测试笔记',
      domain: '为人处世',
      content: '测试正文',
    }),
  )
  const changed = vi.fn()
  const root = await mountNote('为人处世/测试笔记.md', changed)
  const add = root.querySelector('button')
  if (!add) throw new Error('编辑器未加载')
  add.click()
  await nextTick()
  expect(root.textContent).toContain('新领域')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed.mock.calls[0][0].domains).toContainEqual({ id: 100, name: '新领域' })
})

it('读取笔记期间离开，不再加载图片或注册关闭监听', async () => {
  let finish: ((value: ReturnType<typeof parseNoteFile>) => void) | undefined
  vi.mocked(readNote).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  await mountNote('其他/测试.md')
  app?.unmount()
  app = undefined
  if (!finish) throw new Error('未开始读取笔记')
  finish(
    parseNoteFile({
      originalText: '打开时完整文件',
      title: '测试',
      stem: '测试',
      domain: '其他',
      content: '![](../附件/图.png)',
    }),
  )
  for (let i = 0; i < 8; i++) await nextTick()
  expect(readCover).not.toHaveBeenCalled()
  expect(guardClose).not.toHaveBeenCalled()
})
it('离开后关闭监听才注册完成，立即解除监听', async () => {
  const release = vi.fn()
  let finish: ((value: Awaited<ReturnType<typeof guardClose>>) => void) | undefined
  vi.mocked(guardClose).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  vi.mocked(readNote).mockResolvedValueOnce(
    parseNoteFile({ originalText: '打开时完整文件', title: '测试', stem: '测试', domain: '其他', content: '正文' }),
  )
  await mountNote('其他/测试.md')
  expect(guardClose).toHaveBeenCalledTimes(1)
  app?.unmount()
  app = undefined
  if (!finish) throw new Error('未开始注册监听')
  finish(release)
  await nextTick()
  expect(release).toHaveBeenCalledTimes(1)
})

it('编辑器返回请求复用未保存确认，取消留在页面，确认后才离开', async () => {
  vi.mocked(readNote).mockResolvedValueOnce(
    parseNoteFile({ originalText: '打开时完整文件', title: '测试', stem: '测试', domain: '其他', content: '正文' }),
  )
  const back = vi.fn()
  const root = await mountNote('其他/测试.md', vi.fn(), back)
  const edit = root.querySelector<HTMLButtonElement>('.test-edit')
  const requestBack = root.querySelector<HTMLButtonElement>('.test-back')
  if (!edit || !requestBack) throw new Error('缺少编辑器测试入口')
  requestBack.click()
  expect(back).toHaveBeenCalledExactlyOnceWith(false)
  back.mockClear()
  edit.click()
  requestBack.click()
  await nextTick()
  expect(back).not.toHaveBeenCalled()
  expect(root.textContent).toContain('有修改还没保存')
  const cancel = root.querySelector<HTMLButtonElement>('[role="alertdialog"] button.soft')
  if (!cancel) throw new Error('缺少继续编辑按钮')
  cancel.click()
  await nextTick()
  expect(root.querySelector('[role="alertdialog"]')).toBeNull()
  expect(back).not.toHaveBeenCalled()
  requestBack.click()
  await nextTick()
  const leave = root.querySelector<HTMLButtonElement>('[role="alertdialog"] button.primary')
  if (!leave) throw new Error('缺少不保存离开按钮')
  leave.click()
  expect(back).toHaveBeenCalledExactlyOnceWith(false)
})
