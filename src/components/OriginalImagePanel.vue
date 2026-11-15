<script setup lang="ts">
// 提取内容的原图对照：确认页显示完整原图、识别范围和识别初稿；
// 重开笔记时没有初稿，只显示完整原图，识别文字以左侧最终正文为准。
import { computed, ref, watch } from 'vue'
import type { Rect } from '../core/image'

const props = defineProps<{
  images: { url: string; name: string; region?: Rect | null; text: string }[]
  /** 正文点中的段落属于第几张图（从 0 开始） */
  active: number | null
  showText: boolean
}>()

const emit = defineEmits<{ preview: [url: string] }>()
const listEl = ref<HTMLElement>()
const selected = ref(0)
const index = computed(() => Math.min(selected.value, props.images.length - 1))
const image = computed(() => props.images[index.value])
const naturals = ref(props.images.map(() => ({ w: 0, h: 0 })))
const hasRegions = computed(() => props.images.some((image) => image.region))
const hint = computed(() => {
  if (!props.showText) return '对照完整原图；识别文字以左侧正文为准。'
  return hasRegions.value ? '对照完整原图核对文字；虚线框是这张图的识别范围。' : '对照完整原图核对识别文字。'
})

function onLoad(i: number, e: Event) {
  const img = e.target as HTMLImageElement
  naturals.value[i] = { w: img.naturalWidth, h: img.naturalHeight }
}

function regionStyle(i: number) {
  const region = props.images[i].region
  const size = naturals.value[i]
  if (!region || !size?.w || !size.h) return { display: 'none' }
  return {
    left: `${(region.x / size.w) * 100}%`,
    top: `${(region.y / size.h) * 100}%`,
    width: `${(region.w / size.w) * 100}%`,
    height: `${(region.h / size.h) * 100}%`,
  }
}

function select(i: number) {
  selected.value = i
  if (listEl.value) listEl.value.scrollTop = 0
}

watch(
  () => props.active,
  (i) => {
    if (i !== null && i >= 0 && i < props.images.length) select(i)
  },
)
</script>

<template>
  <aside class="panel" aria-label="原图对照">
    <p class="hint">{{ hint }}</p>
    <div v-if="images.length > 1" class="paging">
      <span aria-live="polite">第 {{ index + 1 }} 张 / 共 {{ images.length }} 张</span>
      <button type="button" class="link" :disabled="index === 0" @click="select(index - 1)">上一张</button>
      <button type="button" class="link" :disabled="index === images.length - 1" @click="select(index + 1)">
        下一张
      </button>
    </div>
    <div ref="listEl" class="list">
      <figure v-if="image" :key="index" class="item">
        <figcaption>原图</figcaption>
        <button type="button" class="frame" :aria-label="`查看原图：${image.name}`" @click="emit('preview', image.url)">
          <img :src="image.url" :alt="image.name" @load="onLoad(index, $event)" />
          <span v-if="image.region" class="region" :style="regionStyle(index)" aria-hidden="true" />
        </button>
        <section v-if="showText" class="text">
          <h3>识别文字</h3>
          <p v-if="image.text.trim()">{{ image.text }}</p>
          <p v-else class="missing">这张图没有识别到文字。</p>
        </section>
      </figure>
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
.hint {
  margin: var(--sp-4) var(--sp-5) 0;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--faint);
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.paging {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-5) 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.paging span {
  margin-inline-end: auto;
}
.item {
  margin: 0;
}
.text h3 {
  margin: 0;
  font-size: inherit;
}
.text p {
  margin: var(--sp-1) 0 0;
}
figcaption {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.missing {
  color: var(--warn);
}
.frame {
  display: block;
  height: auto;
  padding: 0;
  border: 0;
  cursor: zoom-in;
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.frame img {
  display: block;
  width: 100%;
  height: auto;
}
.region {
  position: absolute;
  border: 1px dashed var(--accent);
  pointer-events: none;
}
.text {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sm);
  line-height: 1.7;
  color: var(--fg);
  white-space: pre-wrap;
}
</style>
