// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type FunctionalComponent } from 'vue'
import NotePage from './NotePage.vue'
import { defaultConfig, type Config } from '../core/config'
import { parseNoteFile } from '../core/note'
import { readNote } from '../shell/tauri'

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
  const editor: FunctionalComponent<{ config: Config }> = (props, { emit }) =>
    h(
      'button',
      {
        onClick: () =>
          emit('configChanged', {
            ...props.config,
            domains: [...props.config.domains, { id: 100, name: '新领域' }],
          }),
      },
      props.config.domains.map((d) => d.name).join(','),
    )
  editor.props = ['config']
  editor.emits = ['configChanged']
  return { default: editor }
})
let app: App
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
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
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(NotePage, { config: defaultConfig(), path: '为人处世/测试笔记.md', onConfigChanged: changed })
  app.mount(root)
  for (let i = 0; i < 5; i++) await nextTick()
  const add = root.querySelector('button')
  if (!add) throw new Error('编辑器未加载')
  add.click()
  await nextTick()
  expect(root.textContent).toContain('新领域')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed.mock.calls[0][0].domains).toContainEqual({ id: 100, name: '新领域' })
})
