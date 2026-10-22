// 收藏库方块卡片和列表行共用的封面图（成熟做法）：列表里只放缩略图，模糊图提前画好（后台线程里做，见 core/thumbs），
// 图片在后台解码好再显示，快滚进屏幕（提前 300px）才开始读图。读不到就当没有图片
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { coverPath, type LibraryNote } from '../core/library'
import { makeThumbs } from '../core/thumbs'
import { readCover } from '../shell/tauri'

export function useCover(el: Ref<HTMLElement | undefined>, note: () => LibraryNote, root: () => string) {
  const thumbUrl = ref('')
  const blurredUrl = ref('')
  let seen: IntersectionObserver | undefined

  async function load() {
    const rel = coverPath(note())
    if (!rel) return
    try {
      const { thumb, blurred } = await makeThumbs(await readCover(root(), rel))
      const urls = [URL.createObjectURL(thumb), URL.createObjectURL(blurred)]
      await Promise.all(urls.map((u) => Object.assign(new Image(), { src: u }).decode()))
      ;[thumbUrl.value, blurredUrl.value] = urls
    } catch {
      // 图片被删了、挪走了或解不开：退回显示正文，不算错误
    }
  }
  onMounted(() => {
    seen = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        seen?.disconnect()
        void load()
      },
      { rootMargin: '300px' },
    )
    if (el.value) seen.observe(el.value)
  })
  onBeforeUnmount(() => {
    seen?.disconnect()
    for (const u of [thumbUrl.value, blurredUrl.value]) if (u) URL.revokeObjectURL(u)
  })
  return { thumbUrl, blurredUrl }
}
