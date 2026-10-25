// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type SetupContext } from 'vue'
import type { Job } from '../core/pipeline'
import type { EditInfo } from './ConfirmPage.vue'
import type { NoteRecovery } from '../core/noteRecovery'
import NotePage from './NotePage.vue'
import { defaultConfig, notesRoot, type Config } from '../core/config'
import { parseNoteFile } from '../core/note'
import { clearEditRecovery, listEditRecoveries, readNote, readCover, guardClose } from '../shell/tauri'

vi.mock('../shell/tauri', () => ({
  listEditRecoveries: vi.fn().mockResolvedValue([]),
  clearEditRecovery: vi.fn().mockResolvedValue(undefined),
  readNote: vi.fn(),
  listVaultTags: vi.fn().mockResolvedValue([]),
  guardClose: vi.fn().mockResolvedValue((): void => {}),
  deleteNote: vi.fn(),
  destroyWindow: vi.fn(),
  openNote: vi.fn(),
  readCover: vi.fn(),
}))
vi.mock('./ConfirmPage.vue', () => {
  const editor = {
    props: ['config', 'job', 'edit', 'recovery'],
    emits: ['configChanged', 'back', 'dirty'],
    setup(
      props: { config: Config; job: Job; edit: EditInfo; recovery?: NoteRecovery },
      { emit, expose }: SetupContext<{ configChanged: [Config]; back: []; dirty: [boolean] }>,
    ) {
      expose({ discardRecovery: () => Promise.resolve(true) })
      return () =>
        h('div', [
          h(
            'button',
            {
              'data-image-index': props.job.images?.[0]?.noteImageIndex,
              'data-image-width': props.job.images?.[0]?.width,
              'data-original-text': props.edit.originalText,
              'data-recovered-body': props.recovery?.draft.body,
              'data-recovered-crop': JSON.stringify(props.recovery?.images[0]?.crop),
              'data-image-name': props.job.images?.[0]?.file.name,
              onClick: () =>
                emit('configChanged', {
                  ...props.config,
                  domains: [...props.config.domains, { id: 100, name: '新领域' }],
                }),
            },
            props.config.domains.map((d: Config['domains'][number]) => d.name).join(','),
          ),
          h('button', { class: 'test-back', onClick: () => emit('back') }, '返回'),
          h('button', { class: 'test-edit', onClick: () => emit('dirty', true) }, '修改'),
        ])
    },
  }
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
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listEditRecoveries).mockResolvedValue([])
})
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
  expect(root.textContent).toContain('修改尚未保存')
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
  expect(leave.textContent).toBe('不保存，离开')
  leave.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(back).toHaveBeenCalledExactlyOnceWith(false)
})
function recoveryRecord(): NoteRecovery {
  return {
    version: 1,
    root: notesRoot(defaultConfig()),
    path: '其他/测试.md',
    savedAt: 1,
    originalText: '上次打开时完整文件',
    images: [],
    draft: {
      title: '恢复标题',
      domainId: 99,
      tags: [],
      keywords: [],
      summary: '',
      body: '恢复正文',
      image_captions: [],
    },
  }
}
it('重开有恢复副本的笔记先询问，恢复只打开编辑器不保存文件', async () => {
  vi.mocked(listEditRecoveries).mockResolvedValueOnce([recoveryRecord()])
  vi.mocked(readNote).mockResolvedValueOnce(
    parseNoteFile({ originalText: '现在的文件', title: '测试', stem: '测试', domain: '其他', content: '原正文' }),
  )
  const root = await mountNote('其他/测试.md')
  expect(root.textContent).toContain('上次编辑未正常结束')
  expect(root.textContent).toContain('笔记已在其他程序修改')
  const restore = [...root.querySelectorAll('button')].find((b) => b.textContent === '恢复修改')
  if (!restore) throw new Error('缺少恢复入口')
  restore.click()
  await nextTick()
  expect(root.querySelector('[data-recovered-body]')?.getAttribute('data-recovered-body')).toBe('恢复正文')
  expect(clearEditRecovery).not.toHaveBeenCalled()
})
it.each(['Escape', 'mask'])('恢复只有两个按钮，%s关闭不清除副本，明确放弃才清除', async (dismissBy) => {
  vi.mocked(listEditRecoveries).mockResolvedValueOnce([recoveryRecord()])
  vi.mocked(readNote).mockResolvedValueOnce(
    parseNoteFile({
      originalText: '上次打开时完整文件',
      title: '测试',
      stem: '测试',
      domain: '其他',
      content: '原正文',
    }),
  )
  const back = vi.fn()
  const root = await mountNote('其他/测试.md', vi.fn(), back)
  const dialog = root.querySelector<HTMLElement>('[role="alertdialog"]')
  const mask = root.querySelector<HTMLElement>('.mask')
  if (!dialog || !mask) throw new Error('缺少恢复弹窗')
  expect([...dialog.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['放弃修改', '恢复修改'])
  if (dismissBy === 'Escape')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  else mask.click()
  expect(back).toHaveBeenCalledExactlyOnceWith(false)
  expect(clearEditRecovery).not.toHaveBeenCalled()
  const discard = [...root.querySelectorAll('button')].find((b) => b.textContent === '放弃修改')
  if (!discard) throw new Error('缺少放弃恢复入口')
  discard.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(clearEditRecovery).toHaveBeenCalledExactlyOnceWith(notesRoot(defaultConfig()), '其他/测试.md')
  expect(root.querySelector('[data-recovered-body]')?.getAttribute('data-recovered-body')).toBeUndefined()
})
it.each([true, false])('恢复裁剪匹配正确源图，裁剪已保存=%s', async (alreadySaved) => {
  const rect = { x: 10, y: 10, w: 80, h: 60 }
  const record = recoveryRecord()
  record.images = [{ index: 0, source: '../附件/原图.png', savedCrop: rect, crop: alreadySaved ? rect : null }]
  vi.mocked(listEditRecoveries).mockResolvedValueOnce([record])
  vi.mocked(readCover).mockResolvedValue(new Blob(['isolated-image']))
  vi.mocked(readNote).mockResolvedValueOnce(
    parseNoteFile({
      originalText: '现在的文件',
      title: '测试',
      stem: '测试',
      domain: '其他',
      content: '![图](../附件/已裁剪.png)\n\n正文',
    }),
  )
  const root = await mountNote('其他/测试.md')
  const restore = [...root.querySelectorAll('button')].find((b) => b.textContent === '恢复修改')
  if (!restore) throw new Error('缺少恢复入口')
  restore.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(root.querySelector('[data-image-name]')?.getAttribute('data-image-name')).toBe(
    alreadySaved ? '已裁剪.png' : '原图.png',
  )
  expect(root.querySelector('[data-recovered-crop]')?.getAttribute('data-recovered-crop')).toBe('null')
  expect(readCover).toHaveBeenCalledTimes(alreadySaved ? 1 : 2)
})
