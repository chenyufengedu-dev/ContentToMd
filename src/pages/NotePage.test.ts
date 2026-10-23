// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type FunctionalComponent } from 'vue'
import NotePage from './NotePage.vue'
import { defaultConfig, type Config } from '../core/config'
import { parseNoteFile } from '../core/note'
import { readNote, readCover } from '../shell/tauri'
import type { Job } from '../core/pipeline'

vi.mock('../shell/tauri', () => ({
  readNote: vi.fn(),
  listVaultTags: vi.fn().mockResolvedValue([]),
  guardClose: vi.fn().mockResolvedValue(() => {}),
  deleteNote: vi.fn(),
  destroyWindow: vi.fn(),
  openNote: vi.fn(),
  readCover: vi.fn(),
}))
vi.mock('./ConfirmPage.vue', () => {
  const editor: FunctionalComponent<{ config: Config; job: Job }> = (props, { emit }) =>
    h(
      'button',
      {
        'data-image-index': props.job.images?.[0]?.noteImageIndex,
        onClick: () =>
          emit('configChanged', {
            ...props.config,
            domains: [...props.config.domains, { id: 100, name: '新领域' }],
          }),
      },
      props.config.domains.map((d) => d.name).join(','),
    )
  editor.props = ['config', 'job']
  editor.emits = ['configChanged']
  return { default: editor }
})
it('跳过缺失图片时，保留后续加载图片在笔记中的原始索引', async () => {
  vi.mocked(readNote).mockResolvedValue(
    parseNoteFile({
      title: '测试',
      stem: '测试',
      domain: '为人处世',
      content: '![缺失](../附件/缺失.png)\n\n![正常](../附件/正常.png)\n\n正文',
    }),
  )
  vi.mocked(readCover)
    .mockRejectedValueOnce(new Error('缺失'))
    .mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  const root = await mountNote('为人处世/测试.md')
  expect(root.querySelector('button')?.getAttribute('data-image-index')).toBe('1')
})
let app: App
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
async function mountNote(path: string, onConfigChanged: (c: Config) => void = vi.fn()) {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(NotePage, { config: defaultConfig(), path, onConfigChanged })
  app.mount(root)
  for (let i = 0; i < 8; i++) await nextTick()
  return root
}
it('笔记编辑页更新领域时同时更新当前编辑器并通知应用层', async () => {
  vi.mocked(readNote).mockResolvedValue(
    parseNoteFile({
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
