// 收藏库封面的缩略图和模糊图：交给一个后台线程（thumbWorker）一张一张做，不占界面线程，悬停动画不会被卡住
import type { coverThumbs } from './image'

type Thumbs = Awaited<ReturnType<typeof coverThumbs>>
type Reply = { id: number; error?: string } & Partial<Thumbs>

let worker: Worker | undefined
let nextId = 0
const waiting = new Map<number, (r: Reply) => void>()
// 排队：前一张做完再做下一张，打开收藏库时不会一下子把电脑占满
let queue: Promise<unknown> = Promise.resolve()

function ask(blob: Blob): Promise<Reply> {
  if (!worker) {
    worker = new Worker(new URL('./thumbWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Reply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
  }
  const id = ++nextId
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker!.postMessage({ id, blob })
  })
}

export function makeThumbs(blob: Blob): Promise<Thumbs> {
  const job = queue.then(() => ask(blob))
  queue = job.catch(() => {})
  return job.then((r) => {
    if (r.error || !r.thumb || !r.blurred) throw new Error(r.error ?? '未能取得视频缩略图。')
    return { thumb: r.thumb, blurred: r.blurred }
  })
}
