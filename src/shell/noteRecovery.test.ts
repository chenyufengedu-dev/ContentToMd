// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { clearEditRecovery, listEditRecoveries, saveEditRecovery } from './tauri'
import type { NoteRecovery } from '../core/noteRecovery'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const record: NoteRecovery = {
  version: 1,
  root: 'isolated-root',
  path: '其他/a.md',
  savedAt: 1,
  originalText: '原文件',
  images: [],
  draft: {
    title: '标题',
    domainId: 99,
    tags: [],
    keywords: [],
    summary: '',
    body: '保留末尾空白  \n',
    image_captions: [],
  },
}
it('慢写入结束后才清除，清除不会被旧写入反向覆盖；读取恢复完整编辑内容', async () => {
  let finish: () => void = () => {}
  vi.mocked(invoke)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce([JSON.stringify(record)])
  const write = saveEditRecovery(record)
  const clear = clearEditRecovery(record.root, record.path)
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledTimes(1)
  finish()
  await Promise.all([write, clear])
  expect(invoke).toHaveBeenNthCalledWith(2, 'edit_recovery_write', { root: record.root, path: record.path, json: null })
  expect(await listEditRecoveries()).toEqual([record])
})
it('读取损坏副本报错且不自动清除', async () => {
  vi.mocked(invoke).mockClear().mockResolvedValueOnce(['{"version":2}'])
  await expect(listEditRecoveries()).rejects.toThrow()
  expect(invoke).toHaveBeenCalledExactlyOnceWith('edit_recovery_list')
})
