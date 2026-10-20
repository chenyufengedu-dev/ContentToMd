<script setup lang="ts">
// 原文对照：和正文并排显示，两边各自滚动。原文按句子显示：
// 正文点中的那一段对应的句子高亮；没被笔记用到的句子颜色变淡（F30）
import { computed, nextTick, ref, watch } from 'vue'
import { FileText, X, CircleHelp } from 'lucide-vue-next'
import type { Sentence } from '../core/sourceMatch'

const props = defineProps<{
  sentences: Sentence[]
  unused: boolean[]
  /** 正文点中的段落对应的句子范围；null 表示没点，'none' 表示点了但原文里没找到 */
  active: { from: number; to: number } | 'none' | null
}>()
const emit = defineEmits<{ close: []; scroll: [] }>()

const textEl = ref<HTMLElement>()
const unusedCount = computed(() => props.unused.filter(Boolean).length)
const totalChars = computed(() => props.sentences.reduce((n, s) => n + s.text.length, 0))
const isActive = (i: number) =>
  props.active && props.active !== 'none' && i >= props.active.from && i <= props.active.to

// 点中新的段落时，把对应句子滚到原文栏中间
watch(
  () => props.active,
  async (a) => {
    if (!a || a === 'none') return
    await nextTick()
    textEl.value?.querySelector(`[data-i="${a.from}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
)

/** 给确认页画连线用：对应句子的位置 */
function activeRect(): DOMRect | null {
  if (!props.active || props.active === 'none' || !textEl.value) return null
  const first = textEl.value.querySelector(`[data-i="${props.active.from}"]`)
  const last = textEl.value.querySelector(`[data-i="${props.active.to}"]`)
  if (!first || !last) return null
  const a = first.getBoundingClientRect()
  const b = last.getBoundingClientRect()
  return new DOMRect(a.left, a.top, Math.max(a.right, b.right) - a.left, b.bottom - a.top)
}
function viewportRect(): DOMRect | null {
  return textEl.value?.getBoundingClientRect() ?? null
}
defineExpose({ activeRect, viewportRect })
</script>

<template>
  <aside class="panel" aria-label="原文对照">
    <header class="head">
      <span class="icon-tile"><FileText :size="18" /></span>
      <div class="head-text">
        <h2>原文对照</h2>
        <p class="sub">语音转写 · 共 {{ totalChars }} 字</p>
      </div>
      <button class="close" aria-label="收起原文" @click="emit('close')"><X :size="18" /></button>
    </header>
    <p class="hint">
      <CircleHelp :size="14" aria-hidden="true" />
      点击左边正文的一段，这里会标出它对应的原文。颜色较淡的 {{ unusedCount }} 句是笔记里没有写到的内容。
    </p>
    <p v-if="active === 'none'" class="not-found">
      这一段在原文里没有找到明显对应的内容，可能是 AI 改写较多或补充的内容。
    </p>
    <div ref="textEl" class="text" @scroll="emit('scroll')">
      <span
        v-for="(s, i) in sentences"
        :key="i"
        class="sentence"
        :data-i="i"
        :class="{ unused: unused[i], active: isActive(i) }"
        >{{ s.text }}</span
      >
    </div>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-5) var(--sp-5) var(--sp-3);
}
.icon-tile {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  background: var(--primary-soft);
  color: var(--primary);
}
.head-text {
  flex: 1;
}
h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-strong);
}
.sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--faint);
}
.close {
  width: var(--h-sm);
  height: var(--h-sm);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.hint {
  display: flex;
  gap: 6px;
  margin: 0 var(--sp-5);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--card-muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--muted);
}
.hint svg {
  flex: none;
  margin-top: 3px;
}
.not-found {
  margin: var(--sp-2) var(--sp-5) 0;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.text {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5) var(--sp-6);
  font-size: var(--fs-md);
  line-height: 2;
  color: var(--fg);
}
.sentence {
  border-radius: 4px;
  transition:
    background var(--ease),
    color var(--ease);
}
.sentence.unused {
  color: var(--faint);
}
.sentence.active {
  background: var(--primary-soft);
  color: var(--fg-strong);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
</style>
