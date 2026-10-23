// 收藏库方块卡片和列表行共用的封面图（成熟做法）：列表里只放缩略图，模糊图提前画好（后台线程里做，见 core/thumbs），
// 图片在后台解码好再显示，快滚进屏幕（提前 300px）才开始读图。读不到就当没有图片
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { coverPath, type LibraryNote } from '../core/library'
import { makeThumbs } from '../core/thumbs'
import { readCover } from '../shell/tauri'

export function useCover(el: Ref<HTMLElement | undefined>, note: () => LibraryNote, root: () => string) {
  const thumbUrl = ref('')
  const blurredUrl = ref('')
  let seen: IntersectionObserver | undefined
  let visible = false
  let disposed = false
  let controller: AbortController | undefined

  async function load() {
    if (disposed) return
    controller?.abort()
    thumbUrl.value = ''
    blurredUrl.value = ''
    const rel = coverPath(note())
    if (!rel) return
    const current = new AbortController()
    controller = current
    const urls: string[] = []
    const release = () => {
      for (const u of urls) URL.revokeObjectURL(u)
      urls.length = 0
    }
    current.signal.addEventListener('abort', release, { once: true })
    try {
      const blob = await readCover(root(), rel)
      if (current.signal.aborted) return
      const { thumb, blurred } = await makeThumbs(blob)
      if (current.signal.aborted) return
      urls.push(URL.createObjectURL(thumb))
      urls.push(URL.createObjectURL(blurred))
      await Promise.all(urls.map((u) => Object.assign(new Image(), { src: u }).decode()))
      if (current.signal.aborted) return
      ;[thumbUrl.value, blurredUrl.value] = urls
    } catch {
      release()
      // 图片被删了、挪走了或解不开：退回显示正文，不算错误
    }
  }
  watch([root, () => coverPath(note())], () => {
    if (visible) void load()
  })
  onMounted(() => {
    seen = new IntersectionObserver(
      (es) => {
        if (disposed || visible || !es.some((e) => e.isIntersecting)) return
        visible = true
        seen?.disconnect()
        void load()
      },
      { rootMargin: '300px' },
    )
    if (el.value) seen.observe(el.value)
  })
  onBeforeUnmount(() => {
    disposed = true
    seen?.disconnect()
    controller?.abort()
  })
  return { thumbUrl, blurredUrl }
}
