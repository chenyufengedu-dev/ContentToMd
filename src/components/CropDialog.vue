<script setup lang="ts">
// 调整裁剪（F29）：居中的大浮层，原图上叠一个裁剪框，拖四边、四角调整大小，拖框内移动。
// 多张图时底部缩略图切换；“恢复原图”= 这张不裁。点“完成”才生效，“取消”或 Esc 不改
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { Rect } from '../core/image'

const props = defineProps<{ images: { url: string; crop: Rect | null }[]; start: number }>()
const emit = defineEmits<{ done: [(Rect | null)[]]; cancel: [] }>()

const crops = ref(props.images.map((i) => (i.crop ? { ...i.crop } : null)))
const index = ref(props.start)
const imgEl = ref<HTMLImageElement>()
const stageEl = ref<HTMLElement>()
const natural = ref({ w: 0, h: 0 })
const shown = ref({ w: 0, h: 0 }) // 图片在屏幕上显示的大小
const MIN = 24 // 裁剪框最小边长（原图像素）

/** 图片按比例缩到刚好放进中间的区域（四周留出拖动手柄的位置） */
function measure() {
  const el = imgEl.value
  const stage = stageEl.value
  if (!el || !el.naturalWidth || !stage) return
  natural.value = { w: el.naturalWidth, h: el.naturalHeight }
  const pad = 24
  const k = Math.min(
    1,
    (stage.clientWidth - pad * 2) / el.naturalWidth,
    (stage.clientHeight - pad * 2) / el.naturalHeight,
  )
  shown.value = { w: Math.round(el.naturalWidth * k), h: Math.round(el.naturalHeight * k) }
}

/** 当前这张的裁剪框；不裁时框就是整张图 */
const box = computed<Rect>(() => crops.value[index.value] ?? { x: 0, y: 0, w: natural.value.w, h: natural.value.h })
const scale = computed(() => (natural.value.w ? shown.value.w / natural.value.w : 0))
const boxStyle = computed(() => ({
  left: `${box.value.x * scale.value}px`,
  top: `${box.value.y * scale.value}px`,
  width: `${box.value.w * scale.value}px`,
  height: `${box.value.h * scale.value}px`,
}))
const cropped = computed(() => !!crops.value[index.value])

// ---- 拖动 ----
type Dir = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
let drag: { dir: Dir; x: number; y: number; start: Rect } | null = null

function onDown(e: PointerEvent, dir: Dir) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { dir, x: e.clientX, y: e.clientY, start: { ...box.value } }
}
function onMove(e: PointerEvent) {
  if (!drag || !scale.value) return
  const dx = (e.clientX - drag.x) / scale.value
  const dy = (e.clientY - drag.y) / scale.value
  const { w: W, h: H } = natural.value
  const s = drag.start
  let x0 = s.x
  let y0 = s.y
  let x1 = s.x + s.w
  let y1 = s.y + s.h
  if (drag.dir === 'move') {
    const nx = Math.min(Math.max(0, s.x + dx), W - s.w)
    const ny = Math.min(Math.max(0, s.y + dy), H - s.h)
    ;[x0, y0, x1, y1] = [nx, ny, nx + s.w, ny + s.h]
  } else {
    if (drag.dir.includes('w')) x0 = Math.min(Math.max(0, s.x + dx), x1 - MIN)
    if (drag.dir.includes('e')) x1 = Math.max(Math.min(W, x1 + dx), x0 + MIN)
    if (drag.dir.includes('n')) y0 = Math.min(Math.max(0, s.y + dy), y1 - MIN)
    if (drag.dir.includes('s')) y1 = Math.max(Math.min(H, y1 + dy), y0 + MIN)
  }
  const r = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }
  // 框回到整张图时等于不裁
  crops.value[index.value] = r.x === 0 && r.y === 0 && r.w === W && r.h === H ? null : r
}
function onUp() {
  drag = null
}

function restore() {
  crops.value[index.value] = null
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div class="mask" @click.self="emit('cancel')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="调整裁剪">
      <header class="head">
        <h2>调整裁剪</h2>
        <button class="close" aria-label="关闭" @click="emit('cancel')"><X :size="18" /></button>
      </header>

      <div ref="stageEl" class="stage">
        <div class="frame" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
          <img
            ref="imgEl"
            :src="images[index].url"
            alt=""
            draggable="false"
            :style="shown.w ? { width: `${shown.w}px`, height: `${shown.h}px` } : { visibility: 'hidden' }"
            @load="measure"
          />
          <div v-if="scale" class="box" :class="{ full: !cropped }" :style="boxStyle">
            <div class="move" @pointerdown="onDown($event, 'move')" />
            <span class="grid" aria-hidden="true" />
            <span v-for="h in HANDLES" :key="h" class="handle" :class="h" @pointerdown.stop="onDown($event, h)" />
          </div>
        </div>
      </div>

      <footer class="foot">
        <div v-if="images.length > 1" class="thumbs">
          <button
            v-for="(img, i) in images"
            :key="img.url"
            class="thumb"
            :class="{ on: i === index }"
            :aria-label="`第 ${i + 1} 张`"
            @click="index = i"
          >
            <img :src="img.url" alt="" />
          </button>
        </div>
        <div class="buttons">
          <button class="link" :disabled="!cropped" @click="restore">恢复原图</button>
          <button class="secondary" @click="emit('cancel')">取消</button>
          <button class="primary" @click="emit('done', crops)">完成</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: var(--sp-6);
  background: rgb(15 18 25 / 45%);
}
.dialog {
  width: min(1100px, 100%);
  height: min(860px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4) var(--sp-5);
}
.head h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
.close {
  width: var(--h-sm);
  height: var(--h-sm);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.stage {
  flex: 1;
  min-height: 0;
  margin: 0 var(--sp-5);
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--card-muted);
  overflow: hidden;
}
.frame {
  position: relative;
  line-height: 0;
  user-select: none;
  touch-action: none;
}
.frame img {
  display: block;
  max-width: none;
}
.box {
  position: absolute;
  box-shadow: 0 0 0 9999px rgb(15 18 25 / 45%);
  outline: 1.5px solid #fff;
}
.box.full {
  box-shadow: none;
}
.move {
  position: absolute;
  inset: 0;
  cursor: move;
}
/* 三等分参考线 */
.grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to right, transparent 33.2%, rgb(255 255 255 / 45%) 33.3%, transparent 33.4%),
    linear-gradient(to right, transparent 66.6%, rgb(255 255 255 / 45%) 66.7%, transparent 66.8%),
    linear-gradient(to bottom, transparent 33.2%, rgb(255 255 255 / 45%) 33.3%, transparent 33.4%),
    linear-gradient(to bottom, transparent 66.6%, rgb(255 255 255 / 45%) 66.7%, transparent 66.8%);
}
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 20%);
}
.nw {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.n {
  left: 50%;
  top: 0;
  cursor: ns-resize;
}
.ne {
  left: 100%;
  top: 0;
  cursor: nesw-resize;
}
.e {
  left: 100%;
  top: 50%;
  cursor: ew-resize;
}
.se {
  left: 100%;
  top: 100%;
  cursor: nwse-resize;
}
.s {
  left: 50%;
  top: 100%;
  cursor: ns-resize;
}
.sw {
  left: 0;
  top: 100%;
  cursor: nesw-resize;
}
.w {
  left: 0;
  top: 50%;
  cursor: ew-resize;
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
}
.thumbs {
  display: flex;
  gap: var(--sp-2);
}
.thumb {
  width: 64px;
  height: 64px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--card-muted);
}
.thumb.on {
  border-color: var(--primary);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.buttons {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.buttons .link {
  color: var(--muted);
}
.buttons .secondary {
  border: 0;
  background: var(--hover);
}
.buttons .primary,
.buttons .secondary {
  min-width: 96px;
}
</style>
