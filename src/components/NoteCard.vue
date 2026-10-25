<script setup lang="ts">
// 收藏库页的方块卡片（设计稿：设计稿/收藏库页/基准.webp）：像一份存起来的文档，鼠标放上去就“抽出来”一点。
// 外面一圈粗边框；里面两层：下层是封面图或正文，平时是模糊的；
// 上层是左上角带梯形标签的白色一整块，标签里是序号，下面标题和三行正文摘录；领域 · 日期和标签在卡片底部。
//
// 动画（docs/进度.md S2 第 2 步、usePull）：一个“抽出程度”由弹簧推动，
// 每帧只改会动的那几个元素自己的位移和透明度：上层下移到卡片中间偏下，摘录、标签随之淡出，
// 领域往下挪到标签的位置，清楚的那层淡入、图片弹一下，右上角 ↗ 弹出来。快速来回时弹簧带着速度转向，不会顿。
// 轻量：模糊那层固定不动（封面用提前模糊好的图，正文只模糊一次），动的只是叠在上面的清楚层的透明度；列表里只放缩略图
// 平时卡片是普通静态画面，只有正在动的那张才交给显卡（is-live），停稳后还回去
import { vPress } from './pressFeedback'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUpRight } from './icons'
import { cardDate, previewLines, type LibraryNote } from '../core/library'
import { tabPath } from './tabShape'
import { clamp01, usePull } from './usePull'
import { useCover } from './useCover'

const props = defineProps<{ note: LibraryNote; index: number; root: string }>()
const emit = defineEmits<{ open: [] }>()

const MAX_TAGS = 3
const num = computed(() => String(props.index + 1).padStart(2, '0'))
const meta = computed(() => [props.note.domain, cardDate(props.note.created)].filter(Boolean).join(' · '))
const tags = computed(() => props.note.tags.slice(0, MAX_TAGS))
/** 上层标题下面的三行正文（第一行通常是“这条讲什么”） */
const excerpt = computed(() => previewLines(props.note.body, 4).join(' '))
const lines = computed(() => previewLines(props.note.body, 8))

// 标签：高 40，平顶宽 64（放得下三位数序号），圆角和卡片一致
const TAB_H = 40
const tab = tabPath({ width: 64, height: TAB_H, radius: 12, slant: 16, foot: 10 })
/** 上层下移卡片高度的 27%：顶边从 30% 落到 57% 左右 */
const MOVE = 0.27

const card = ref<HTMLElement>()
const clipEl = ref<HTMLElement>()
const front = ref<HTMLElement>()
const excerptEl = ref<HTMLElement>()
const foot = ref<HTMLElement>()
const tagsEl = ref<HTMLElement>()
const sharp = ref<HTMLElement>()
const go = ref<HTMLElement>()
const { thumbUrl, blurredUrl } = useCover(
  card,
  () => props.note,
  () => props.root,
)

/** 按抽出程度 p 摆好各部分；只写 transform 和 opacity */
let move = 0
let shift = 0
function apply(p: number) {
  if (front.value) front.value.style.transform = `translateY(${p * move}px)`
  if (excerptEl.value) excerptEl.value.style.opacity = String(clamp01(1 - p * 3))
  if (tagsEl.value) tagsEl.value.style.opacity = String(clamp01(1 - (p - 0.1) * 3))
  if (foot.value) foot.value.style.transform = `translateY(${p * shift}px)`
  if (sharp.value) {
    sharp.value.style.opacity = String(clamp01((p - 0.1) * 2))
    // 清楚的图片从 106% 落回 100%，弹簧冲过一点时也还盖满，不露边
    if (thumbUrl.value) sharp.value.style.transform = `scale(${1.06 - 0.05 * p})`
  }
  if (go.value) {
    go.value.style.opacity = String(clamp01((p - 0.3) * 2.5))
    go.value.style.transform = `scale(${0.6 + 0.4 * p})`
  }
}
const { pull, onFocus, now } = usePull(card, apply)

// 尺寸提前量好（卡片出现时、窗口变大小时），放上去那一刻不再让浏览器排版
let sizer: ResizeObserver | undefined
function measure() {
  move = (clipEl.value?.clientHeight ?? 0) * MOVE
  shift = tagsEl.value ? tagsEl.value.offsetHeight + 4 : 0
  apply(now())
}
onMounted(() => {
  measure()
  sizer = new ResizeObserver(measure)
  if (clipEl.value) sizer.observe(clipEl.value)
})
onBeforeUnmount(() => sizer?.disconnect())
// 封面图是卡片出现后才加载进来的，进来后按当前抽出程度摆一次（不然清楚的那张会一直盖在模糊图上面）
watch(thumbUrl, () => apply(now()), { flush: 'post' })
</script>

<template>
  <button
    ref="card"
    v-press="'ripple'"
    class="note-card"
    :aria-label="`打开笔记：${note.title}（第 ${num} 条）`"
    @pointerenter="pull(true)"
    @pointerleave="pull(false)"
    @focus="onFocus"
    @blur="pull(false)"
    @click="emit('open')"
  >
    <span ref="clipEl" class="clip">
      <span class="back">
        <template v-if="thumbUrl">
          <img class="cover is-blurred" :src="blurredUrl" alt="" />
          <img ref="sharp" class="cover is-sharp" :src="thumbUrl" alt="" />
        </template>
        <template v-else>
          <span class="back-text is-blurred" aria-hidden="true">
            <span v-for="(l, i) in lines" :key="i">{{ l }}</span>
          </span>
          <span ref="sharp" class="back-text is-sharp" aria-hidden="true">
            <span v-for="(l, i) in lines" :key="i">{{ l }}</span>
          </span>
        </template>
      </span>
      <span ref="front" class="front" :style="{ '--tab-h': `${TAB_H}px` }">
        <svg class="front-tab" :width="tab.width" :height="tab.height" :viewBox="`0 0 ${tab.width} ${tab.height}`">
          <path :d="tab.d" />
        </svg>
        <span class="front-body" />
        <span class="front-content">
          <span class="num">{{ num }}</span>
          <span class="title">{{ note.title }}</span>
          <span v-if="excerpt" ref="excerptEl" class="excerpt">{{ excerpt }}</span>
        </span>
        <span ref="go" class="go"><ArrowUpRight :size="16" aria-hidden="true" /></span>
      </span>
      <span ref="foot" class="foot">
        <span class="meta">{{ meta }}</span>
        <span v-if="tags.length" ref="tagsEl" class="tags">
          <span v-for="t in tags" :key="t">#{{ t }}</span>
        </span>
      </span>
    </span>
  </button>
</template>

<style scoped>
/* 像一张竖着的文档（3:4）；外面一圈粗边框 */
.note-card {
  --ring: calc(var(--sp-4) / 4);
  position: relative;
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 4;
  padding: var(--ring);
  border: 0;
  border-radius: calc(var(--panel-radius) + var(--ring));
  background: var(--line);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
}
.note-card:hover:not(:disabled) {
  background: var(--line); /* 不要按钮通用的悬停底色 */
}
.note-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.clip {
  position: relative;
  display: block;
  height: 100%;
  overflow: hidden;
  border-radius: var(--panel-radius);
  isolation: isolate;
}

/* ---- 下层：封面图或正文；模糊的那层固定不动，清楚的那层叠在上面淡入 ---- */
.back {
  position: absolute;
  inset: 0;
  background: var(--card-muted);
}
.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.back-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-4);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.back-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 封面的模糊层：生成缩略图时就已经模糊好了，显示时不用模糊滤镜 */
.cover.is-blurred {
  opacity: 0.8;
}
/* 正文的模糊层：只在卡片出现时模糊一次，之后不再变 */
.back-text.is-blurred {
  color: var(--faint);
  opacity: 0.8;
  filter: blur(4px);
}
.is-sharp {
  opacity: 0;
}
.back-text.is-sharp {
  color: var(--muted);
  background: var(--card-muted); /* 盖住下面模糊的字 */
}

/* ---- 上层：从卡片 30% 处开始，比卡片还高，往下滑时下面被裁掉 ---- */
.front {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(30% - var(--tab-h));
  height: 100%;
}
.front-tab {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  fill: var(--card);
}
.front-body {
  position: absolute;
  top: var(--tab-h);
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--card);
  border-top-right-radius: var(--panel-radius);
}
.front-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-1) var(--sp-4);
}
/* 序号用 Segoe UI 粗体：苹方在作者电脑上没有粗体文件（作者 2026-10-21 同意） */
.num {
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  font-size: var(--fs-deco);
  font-weight: 700;
  line-height: calc(var(--tab-h) - var(--sp-1));
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}
.title {
  display: -webkit-box;
  margin-top: var(--sp-3);
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  padding-right: var(--sp-5); /* 抽出时右上角出现 ↗，标题不伸到它下面 */
  font-size: var(--fs-md);
  font-weight: var(--fw-title);
  line-height: 1.5;
  color: var(--fg-strong);
}
.excerpt {
  display: -webkit-box;
  margin-top: var(--sp-2);
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--faint);
}
.go {
  position: absolute;
  top: calc(var(--tab-h) + var(--sp-4));
  right: var(--sp-4);
  display: flex;
  color: var(--accent);
}

/* ---- 底部：领域 · 日期和标签 ---- */
.foot {
  position: absolute;
  left: var(--sp-4);
  right: var(--sp-4);
  bottom: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--faint);
}
.tags {
  display: flex;
  gap: var(--sp-2);
  overflow: hidden;
  white-space: nowrap;
}

/* 只有正在动的那张卡片把会动的几层交给显卡，停稳后还回去，平时不多占内存 */
.is-live .front,
.is-live .foot,
.is-live .is-sharp,
.is-live .go {
  will-change: transform, opacity;
}
</style>
