import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { defaultConfig } from '../core/config'
import { inspectCollection } from './tauri'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
it('按实际笔记子目录检查收藏库，复用领域合并，不改原配置', async () => {
  const config = defaultConfig()
  config.vaultPath = 'C:\\test\\Obsidian'
  config.vault = { kind: 'obsidian', subfolder: '剪藏' }
  config.domains.unshift({ id: 7, name: '设计UI' })
  vi.mocked(invoke).mockResolvedValueOnce({ domains: ['AI与Agent', '设计UI', '其他'], hasNotes: true })
  const inspected = await inspectCollection(config)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('inspect_collection', { root: 'C:\\test\\Obsidian\\剪藏' })
  expect(inspected.hasNotes).toBe(true)
  expect(inspected.config.domains).toEqual([
    { id: 7, name: '设计UI' },
    { id: 8, name: 'AI与Agent' },
    { id: 99, name: '其他' },
  ])
  expect(config.domains).toHaveLength(2)
})
it('检查失败保持错误，不把不可读取的库当成空库', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('无法读取目录'))
  await expect(inspectCollection(defaultConfig())).rejects.toThrow('无法读取目录')
})
