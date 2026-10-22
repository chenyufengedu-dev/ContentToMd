<script setup lang="ts">
// 收藏库页列表显示的一行（设计稿：设计稿/收藏库页/状态-列表.webp）：序号；标题、一行摘录、“领域 · 日期”和标签；最右边的缩略图。
// 鼠标放上去（usePull，和方块卡片同一套弹簧）：像选中了这一条——淡灰底出现，序号、标题、摘录一起放大，
// “领域 · 日期”那一行往下滑开并淡出，摘录的第二行从左往右一点点写出来占住它的位置，缩略图变清楚并放大，旁边出现 ↗。
// 摘录“变多”不改行数（会重新排版）：两行的摘录一直在，平时用遮罩只露第一行，抽出时第二行的遮罩从左往右拉开。
// 写出来要慢一点才看得出“逐步”，所以单独用一段 0.5 秒的动画，不跟弹簧走
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { animate, motionValue } from 'motion'
import { ArrowUpRight } from 'lucide-vue-next'
import { cardDate, previewLines, type LibraryNote } from '../core/library'
import { clamp01, usePull } from './usePull'
import { useCover } from './useCover'

const props = defineProps<{ note: LibraryNote; index: number; root: string }>()
const emit = defineEmits<{ open: [] }>()

const MAX_TAGS = 3
const GROW = 0.15 // 抽出时缩略图放大的比例
const TEXT_GROW = 0.025 // 抽出时序号、标题、摘录一起放大的比例（再大会碰到右边的 ↗）
const SLIDE = 8 // 抽出时“领域 · 日期”那一行往下滑开的距离
const num = computed(() => String(props.index + 1).padStart(2, '0'))
const tags = computed(() => props.note.tags.slice(0, MAX_TAGS))
const excerpt = computed(() => previewLines(props.note.body, 4).join(' '))

const row = ref<HTMLElement>()
const bg = ref<HTMLElement>()
const content = ref<HTMLElement>()
const excerptEl = ref<HTMLElement>()
const metaEl = ref<HTMLElement>()
const thumb = ref<HTMLElement>()
const sharp = ref<HTMLElement>()
const go = ref<HTMLElement>()
const { thumbUrl, blurredUrl } = useCover(
  row,
  () => props.note,
  () => props.root,
)

/** 按抽出程度 p 摆好各部分；只写 transform 和 opacity */
function apply(p: number) {
  const r = clamp01(p)
  if (bg.value) bg.value.style.opacity = String(r)
  if (content.value) content.value.style.transform = `scale(${1 + TEXT_GROW * p})`
  if (metaEl.value) {
    metaEl.value.style.opacity = String(1 - clamp01(p * 2.5))
    metaEl.value.style.transform = `translateY(${SLIDE * p}px)`
  }
  if (thumb.value) thumb.value.style.transform = `scale(${1 + GROW * p})`
  if (sharp.value) sharp.value.style.opacity = String(clamp01((p - 0.1) * 2))
  if (go.value) {
    go.value.style.opacity = String(clamp01((p - 0.3) * 2.5))
    go.value.style.transform = `scale(${0.6 + 0.4 * p})`
  }
}
const { pull: pullRow, onFocus, now } = usePull(row, apply)

// ---- 摘录第二行从左往右写出来（--write 是遮罩右边缘的位置，只设在摘录这一个元素上） ----
const writing = motionValue(0)
let lineW = 0
writing.on('change', (w) => excerptEl.value?.style.setProperty('--write', `${w * lineW}px`))
function pull(out: boolean) {
  pullRow(out)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) writing.jump(out ? 1 : 0)
  // 写出来慢一点（0.5 秒），收回快一点
  else animate(writing, out ? 1 : 0, out ? { duration: 0.5, ease: 'easeOut', delay: 0.08 } : { duration: 0.15 })
}
// 尺寸提前量好，放上去那一刻不再让浏览器排版
let sizer: ResizeObserver | undefined
function measure() {
  const el = excerptEl.value
  // 多走一个渐变边的宽度，写完时渐变边也走出去
  lineW = el ? el.clientWidth + parseFloat(getComputedStyle(el).getPropertyValue('--fade')) : 0
  excerptEl.value?.style.setProperty('--write', `${writing.get() * lineW}px`)
}
onMounted(() => {
  measure()
  sizer = new ResizeObserver(measure)
  if (excerptEl.value) sizer.observe(excerptEl.value)
  apply(now())
})
onBeforeUnmount(() => {
  sizer?.disconnect()
  writing.destroy()
})
// 缩略图是这一行出现后才加载进来的，进来后按当前抽出程度摆一次
watch(thumbUrl, () => apply(now()), { flush: 'post' })
</script>

<template>
  <button
    ref="row"
    class="note-row"
    :aria-label="`${num} ${note.title}，打开文档`"
    @pointerenter="pull(true)"
    @pointerleave="pull(false)"
    @focus="onFocus"
    @blur="pull(false)"
    @click="emit('open')"
  >
    <span ref="bg" class="bg" />
    <span ref="content" class="content">
      <span class="num">{{ num }}</span>
      <span class="main">
        <span class="title">{{ note.title }}</span>
        <span class="body">
          <span ref="excerptEl" class="excerpt">{{ excerpt }}</span>
          <span ref="metaEl" class="meta">
            <span class="domain">{{ note.domain }}</span>
            <span>{{ cardDate(note.created) }}</span>
            <span v-for="t in tags" :key="t">#{{ t }}</span>
          </span>
        </span>
      </span>
    </span>
    <span ref="go" class="go"><ArrowUpRight :size="16" aria-hidden="true" /></span>
    <span class="thumb-slot">
      <span v-if="thumbUrl" ref="thumb" class="thumb">
        <img class="thumb-img" :src="blurredUrl" alt="" />
        <img ref="sharp" class="thumb-img is-sharp" :src="thumbUrl" alt="" />
      </span>
    </span>
  </button>
</template>

<style scoped>
.note-row {
  --thumb: 56px;
  --line-h: calc(var(--fs-sm) * 1.6); /* 摘录一行的高度；“领域 · 日期”那行和它一样高，两行摘录正好占住两行 */
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  width: 100%;
  height: auto;
  padding: var(--sp-4) var(--sp-5);
  border: 0;
  border-radius: 0; /* 行之间的分隔线要直的；圆角只给悬停时的淡灰底 */
  background: none;
  text-align: left;
  cursor: pointer;
}
.note-row:hover:not(:disabled) {
  background: none; /* 悬停底色由 .bg 按抽出程度淡入 */
}
.note-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.bg {
  position: absolute;
  inset: 2px 0;
  border-radius: var(--radius-md);
  background: var(--hover-soft);
  opacity: 0;
  pointer-events: none;
}
/* 序号、标题、摘录一组，抽出时一起放大（从左边放大，不往左边伸） */
.content {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  transform-origin: left center;
}
/* 序号和方块卡片一样用 Segoe UI 粗体（苹方在作者电脑上没有粗体文件） */
.num {
  position: relative;
  flex: none;
  width: 2.2em;
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}
.main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: var(--fw-title);
  color: var(--fg-strong);
}
.body {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(var(--line-h) * 2);
}
/* 两行的摘录一直在；遮罩分两层：第一行一直露着，第二行从左往右写出来（--write 是右边缘，渐变边宽 --fade） */
.excerpt {
  --write: 0px;
  --fade: 48px;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: var(--fs-sm);
  line-height: var(--line-h);
  color: var(--muted);
  mask-image:
    linear-gradient(#000, #000),
    linear-gradient(to right, #000 calc(var(--write) - var(--fade)), transparent var(--write));
  mask-size:
    100% var(--line-h),
    100% var(--line-h);
  mask-position:
    0 0,
    0 var(--line-h);
  mask-repeat: no-repeat;
}
/* 领域 · 日期和标签：比摘录小一号、淡一点，领域是个小胶囊；平时盖在摘录第二行的位置 */
.meta {
  position: absolute;
  left: 0;
  right: 0;
  top: var(--line-h);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--line-h);
  color: var(--faint);
}
.domain {
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--chip-bg);
  line-height: 1.7;
  color: var(--muted);
}
.go {
  position: relative;
  flex: none;
  display: flex;
  color: var(--accent);
  opacity: 0;
}
.thumb-slot {
  position: relative;
  flex: none;
  width: var(--thumb);
  height: var(--thumb);
}
.thumb {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-img.is-sharp {
  opacity: 0;
}

/* 只有正在动的那一行把会动的几层交给显卡，停稳后还回去 */
.is-live .bg,
.is-live .meta,
.is-live .thumb,
.is-live .is-sharp,
.is-live .go {
  will-change: transform, opacity;
}
</style>
