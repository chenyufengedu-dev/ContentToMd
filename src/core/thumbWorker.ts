// 后台线程：生成收藏库卡片的缩略图和模糊图（解码原图、画布上模糊、编码都很费，放在界面线程会让悬停动画卡一下）
import { coverThumbs } from './image'

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data
  try {
    self.postMessage({ id, ...(await coverThumbs(blob)) })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
