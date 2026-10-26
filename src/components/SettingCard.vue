<script setup lang="ts">
// 设置页的一张卡片。平时左右两栏：左边标题和说明，右边设置内容。
// 点了卡片里的内容后“被抽出来”（像从文件柜里抽出一个文件夹）：卡片下移，左上角露出一个标签，标题在标签里；
// 说明收成一行放在卡片顶部，内容向左铺满整张卡片。
// 标签用一条完整的矢量轮廓画（左右上角都是圆角、右边一条斜边、底部向外翻的弧线平滑接进卡片顶边）。
// 标签垫在卡片内容下面、卡片底色上面，下端比卡片顶边多伸进去一个圆角的高度：
// 动画开始时标签的左上圆角正好和卡片的左上圆角重合；标签往上升时带着圆角一起升，下面露出直的左边，
// 所以任何一帧最外面的轮廓左上角都是圆的，卡片自己的圆角从不切换（见 SettingsPage 的 animateSwitch）
import { computed, onMounted, ref } from 'vue'
import { tabPath } from './tabShape'

defineProps<{
  id: string
  title: string
  desc?: string
  /** 收起时代替说明显示的当前状态（比如收藏库存在哪）：上面一行小字说明，下面一行深色的值 */
  status?: { label: string; value: string }
  open: boolean
  closing?: boolean
  /** 内容少的卡片（关于）：标题和内容上下居中对齐 */
  center?: boolean
}>()
const emit = defineEmits<{ activate: [] }>()

/** 点完卡片里的东西再展开（先让按钮、输入框收到这次点击）；用键盘 Tab 进来时也展开 */
function onFocusIn(e: FocusEvent) {
  if ((e.target as HTMLElement).matches(':focus-visible')) emit('activate')
}

// ---- 标签的轮廓 ----
const TAB_H = 32 // 标签高度
const PAD = 20 // 标题左右留白，和卡片左右内边距一致：标题在标签里的位置正好是它原来的位置
const R = 14 // 上面两个角的圆角，和卡片圆角一致
const SLANT = 16 // 斜边的水平宽度
const FOOT = 12 // 斜边底部向外翻、接进卡片顶边的弧线
const textEl = ref<HTMLElement>()
const textW = ref(64)
onMounted(() => {
  if (textEl.value) textW.value = Math.ceil(textEl.value.getBoundingClientRect().width)
})
const tab = computed(() =>
  tabPath({ width: textW.value + PAD * 2, height: TAB_H, radius: R, slant: SLANT, foot: FOOT }),
)
</script>

<template>
  <section
    class="card"
    :class="{ open, closing, center, 'no-desc': !desc }"
    :data-card="id"
    :style="{ '--tab-h': `${TAB_H}px` }"
    @click="emit('activate')"
    @focusin="onFocusIn"
  >
    <!-- 标签：只露出卡片顶边以上的部分；展开和收回时里面的轮廓上下滑动 -->
    <div v-if="open || closing" class="tab" aria-hidden="true">
      <svg class="tab-shape" :width="tab.width" :height="tab.height" :viewBox="`0 0 ${tab.width} ${tab.height}`">
        <path :d="tab.d" />
      </svg>
    </div>
    <header class="head">
      <h2>
        <span ref="textEl" class="title-text" data-part="title">{{ title }}</span>
      </h2>
      <p v-if="status && !open" class="status" data-part="desc">
        <span class="status-label">{{ status.label }}</span>
        <span class="status-value">{{ status.value }}</span>
      </p>
      <p v-else-if="desc" class="desc" data-part="desc">{{ desc }}</p>
    </header>
    <div class="body" data-part="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  position: relative;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: var(--sp-5);
  /* 上边距让标题的位置和标签里一致，展开时标题几乎不用动 */
  padding: var(--pad-card) var(--sp-5); /* 上下等距，卡片下面不空一截 */
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
  isolation: isolate; /* 让标签的 z-index: -1 只在卡片里面生效 */
}
.head {
  padding-right: var(--sp-5);
  border-right: 1px solid var(--line);
}
h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  line-height: 1.6;
  color: var(--fg-strong);
}
.title-text {
  display: inline-block;
}
.desc {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sm);
  line-height: 1.7;
  color: var(--muted);
}

.status {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: var(--sp-3) 0 0;
}
.status-label {
  font-size: var(--fs-xs);
  color: var(--muted);
}
.status-value {
  font-size: var(--fs-md);
  font-weight: var(--fw-label);
  color: var(--accent);
  overflow-wrap: anywhere;
}

.card.center {
  align-items: center;
}
/* 没有说明文字的居中卡片，展开后上下内边距也相等 */
.card.open.center {
  padding-top: var(--pad-card);
}

/* ---- 标签 ---- */
.tab {
  position: absolute;
  z-index: -1; /* 在卡片底色上面、卡片内容下面 */
  left: 0;
  top: calc(-1 * var(--tab-h));
  line-height: 0;
  pointer-events: none;
}
.tab-shape {
  display: block;
  fill: var(--card);
}

/* ---- 抽出来的样子 ---- */
.card.open {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-3);
  margin-top: var(--tab-h);
  padding-top: var(--sp-2); /* 说明文字离卡片顶边留出一点距离 */
  box-shadow: var(--shadow-pop);
}
.card.open .head {
  padding: 0;
  border: 0;
}
/* 标题放进标签：左边留白和卡片一致，竖直方向居中 */
.card.open h2 {
  position: absolute;
  left: var(--sp-5);
  bottom: 100%;
  height: var(--tab-h);
  display: flex;
  align-items: center; /* 标题在标签里上下居中 */
  line-height: 1.4;
}
/* 没有说明时，标题下面直接是内容，不留空行。
   用类名判断，不用 :has()——:has() 会让浏览器在动画的每一帧重查整张卡片，明显卡顿 */
.card.open.no-desc {
  row-gap: 0;
}
/* 说明收成一行，在卡片顶部 */
.card.open .desc {
  margin: 0;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
