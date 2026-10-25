// 笔记保存失败时给用户看的原因和下一步（方案第 7、8 节）。
// 外壳笔记写入返回一句中文（main.rs 的 write_note、save_note、io_msg），这里统一转换原因与下一步

export interface SaveFailure {
  /** 一句话原因，提示框和按钮上方那一行都用它 */
  reason: string
  /** 接下来怎么做；toSettings 时其中的“设置”可以点 */
  next: string
  toSettings: boolean
}

const KEEP = '当前修改仍保留。'

export function saveFailure(raw: string): SaveFailure {
  if (raw.includes('已被其他程序修改'))
    return {
      reason: '笔记已在其他程序修改，本次未覆盖。',
      next: `请先复制需要的修改，再重新打开笔记核对。${KEEP}`,
      toSettings: false,
    }
  const missing = raw.match(/收藏库文件夹“(.+)”找不到了/)
  if (missing)
    return {
      reason: `找不到收藏库：${missing[1]}。`,
      next: `请到设置重新选择，再尝试保存。${KEEP}`,
      toSettings: true,
    }
  if (raw.includes('没有权限'))
    return { reason: '没有权限写入收藏库。', next: `请到设置选择可写入的文件夹，再尝试保存。${KEEP}`, toSettings: true }
  if (raw.includes('磁盘空间不足'))
    return { reason: '磁盘空间不足，请清理空间后重新保存。', next: KEEP, toSettings: false }
  if (raw.includes('正在被其他程序使用'))
    return { reason: '文件正被其他程序占用，请关闭占用程序后重新保存。', next: KEEP, toSettings: false }
  return { reason: raw.endsWith('。') ? raw : `${raw}。`, next: `请检查后重新保存。${KEEP}`, toSettings: false }
}
