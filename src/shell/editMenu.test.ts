import { expect, it, vi } from 'vitest'
import { showEditMenu } from './tauri'
import { Menu } from '@tauri-apps/api/menu'
const popup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: vi.fn(async () => ({ popup })) } }))
it('原生编辑菜单只含四个编辑命令，没有浏览器导航、刷新、保存或打印', async () => {
  await showEditMenu()
  await showEditMenu()
  expect(Menu.new).toHaveBeenCalledExactlyOnceWith({
    items: [
      { item: 'Cut', text: '剪切' },
      { item: 'Copy', text: '复制' },
      { item: 'Paste', text: '粘贴' },
      { item: 'SelectAll', text: '全选' },
    ],
  })
  expect(popup).toHaveBeenCalledTimes(2)
})
