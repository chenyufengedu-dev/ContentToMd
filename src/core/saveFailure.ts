// 笔记保存失败时给用户看的原因和下一步（方案第 7、8 节）。
// 外壳 write_note 只返回一句中文（main.rs 的 write_note、io_msg），这里是唯一按它的文字分辨原因的地方

export interface SaveFailure {
  /** 一句话原因，提示框和按钮上方那一行都用它 */
  reason: string
  /** 接下来怎么做；toSettings 时其中的“设置”可以点 */
  next: string
  toSettings: boolean
}

const KEEP = '正在编辑的内容不会丢。'

export function saveFailure(raw: string): SaveFailure {
  const missing = raw.match(/收藏库文件夹“(.+)”找不到了/)
  if (missing)
    return {
      reason: `收藏库文件夹不存在：${missing[1]}。`,
      next: `到设置里重新选择文件夹后再保存。${KEEP}`,
      toSettings: true,
    }
  if (raw.includes('没有权限'))
    return { reason: '没有权限写入收藏库文件夹。', next: `到设置里换一个文件夹后再保存。${KEEP}`, toSettings: true }
  if (raw.includes('磁盘空间不足'))
    return { reason: '磁盘空间不足。', next: `清理一些空间后点“重新保存”。${KEEP}`, toSettings: false }
  if (raw.includes('正在被其他程序使用'))
    return { reason: '同名文件正在被其他程序使用。', next: `关掉那个程序后点“重新保存”。${KEEP}`, toSettings: false }
  return { reason: raw.endsWith('。') ? raw : `${raw}。`, next: `可以点“重新保存”再试一次。${KEEP}`, toSettings: false }
}
