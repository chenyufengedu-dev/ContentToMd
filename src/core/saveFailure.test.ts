import { describe, expect, it } from 'vitest'
import { saveFailure } from './saveFailure'

describe('saveFailure', () => {
  it('收藏库文件夹找不到：说清路径，去设置重选', () => {
    const f = saveFailure('收藏库文件夹“D:\\笔记\\收藏库”找不到了，请重新选择')
    expect(f.reason).toBe('收藏库文件夹不存在：D:\\笔记\\收藏库。')
    expect(f.toSettings).toBe(true)
  })
  it('没有权限：去设置换文件夹', () => {
    const f = saveFailure('无法写入“D:\\a\\b.md”：没有权限')
    expect(f.reason).toBe('没有权限写入收藏库文件夹。')
    expect(f.toSettings).toBe(true)
  })
  it('磁盘满：清理后重新保存，不用去设置', () => {
    const f = saveFailure('无法写入“D:\\a”：磁盘空间不足')
    expect(f.reason).toBe('磁盘空间不足。')
    expect(f.toSettings).toBe(false)
  })
  it('文件被占用', () => {
    expect(saveFailure('无法写入“D:\\a”：文件正在被其他程序使用，请关闭后重试').reason).toBe(
      '同名文件正在被其他程序使用。',
    )
  })
  it('认不出的原因：原样给出，点重新保存', () => {
    const f = saveFailure('奇怪的错误')
    expect(f.reason).toBe('奇怪的错误。')
    expect(f.next).toContain('重新保存')
    expect(f.toSettings).toBe(false)
  })
})

it('外部修改冲突提示保留本地修改后重新打开，不建议盲目重试', () => {
  const result = saveFailure('这条笔记已被其他程序修改，未覆盖文件')
  expect(result.reason).toContain('未覆盖')
  expect(result.next).toContain('先复制')
  expect(result.next).toContain('重新打开')
  expect(result.next).not.toContain('重新保存')
  expect(result.toSettings).toBe(false)
})
