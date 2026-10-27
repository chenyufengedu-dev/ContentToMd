<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import art from '../assets/about-art.json'
import {
  clamp,
  easeOut,
  inkPolygon,
  makeStroke,
  pairAt,
  pointAt,
  progressAt,
  TIMELINE,
  tiltCurve,
  type Stroke,
} from '../components/aboutWriting'
/** 原图标里笔尖的位置，也是 M 的最后一个截面 */
const NIB_END = [950, 1073]
const LETTER_STROKES = art.letters.map((_, i) => art.strokes.filter((s) => s.letter === i))
const M = makeStroke(art.mPairs)
const nibAt = (msIntoM: number) => pointAt(M, progressAt(M, msIntoM / TIMELINE.mDur))
const tiltAt = tiltCurve(nibAt)
const T0 = Math.min(...art.strokes.map((s) => s.start))
const T1 = Math.max(...art.strokes.map((s) => s.start + s.duration))
const SCALE = TIMELINE.textDur / (T1 - T0)
interface LiveStroke {
  st: Stroke
  start: number
  dur: number
  poly: SVGPolygonElement
  cap: SVGCircleElement
  state: string
}
interface Parts {
  pen: SVGGElement
  inkPoly: SVGPolygonElement
  inkCap: SVGCircleElement
  letters: { g: SVGGElement; strokes: LiveStroke[] }[]
}
const stage = ref<HTMLElement>()
let parts: Parts | null = null

/** 取模板里自己画的元素；取不到说明模板和这里对不上，直接报错 */
function must<T extends Element>(el: HTMLElement, sel: string): T {
  const node = el.querySelector<T>(sel)
  if (!node) throw new Error(`品牌预览缺少元素：${sel}`)
  return node
}

function collect(el: HTMLElement): Parts {
  return {
    pen: must<SVGGElement>(el, '[data-about="pen"]'),
    inkPoly: must<SVGPolygonElement>(el, '[data-about="ink-poly"]'),
    inkCap: must<SVGCircleElement>(el, '[data-about="ink-cap"]'),
    letters: art.letters.map((_, i) => ({
      g: must<SVGGElement>(el, `[data-letter="${i}"]`),
      strokes: LETTER_STROKES[i].map((s, k) => ({
        st: makeStroke(s.pairs, s.u),
        start: TIMELINE.textStart + (s.start - T0) * SCALE,
        dur: s.duration * SCALE,
        poly: must<SVGPolygonElement>(el, `[data-stroke="${i}-${k}"] polygon`),
        cap: must<SVGCircleElement>(el, `[data-stroke="${i}-${k}"] circle`),
        state: '',
      })),
    })),
  }
}

/** 原型复用正式关于卡片的渲染时序及墨迹遮罩；不调用外壳。 */
function render(t: number) {
  if (!parts) return
  const { pen, inkPoly, inkCap, letters } = parts
  const { land, mStart, mDur } = TIMELINE
  // 羽毛笔：从上方减速落下 → 跟着笔尖写 M → 停在原图标的位置
  const lift = t < land ? 90 * (1 - easeOut(t / land)) : 0
  const nib = nibAt(clamp(t - mStart, 0, mDur))
  const deg = (tiltAt(t) * 180) / Math.PI
  pen.setAttribute(
    'transform',
    `translate(${nib[0]} ${nib[1] - lift}) rotate(${deg.toFixed(3)}) translate(${-NIB_END[0]} ${-NIB_END[1]})`,
  )
  pen.style.opacity = String(t < land ? clamp(t / land / 0.35, 0, 1) : 1)

  // 从书写到完成都保留同一遮罩，避免收笔时恢复边缘而突然加深。
  const f = progressAt(M, clamp((t - mStart) / mDur, 0, 1))
  const head = pairAt(M, f)
  inkPoly.setAttribute('points', f > 0 ? inkPolygon(M, f) : '')
  inkCap.setAttribute('cx', String(nib[0]))
  inkCap.setAttribute('cy', String(nib[1]))
  inkCap.setAttribute('r', String(f > 0 ? Math.hypot(head[0][0] - head[1][0], head[0][1] - head[1][1]) / 2 + 5 : 0))

  // 软件名：只改正在写的那一笔，没开始和已写完的不每帧重设
  for (const L of letters) {
    let done = true
    for (const s of L.strokes) {
      const u = clamp((t - s.start) / s.dur, 0, 1)
      if (u < 1) done = false
      const state = u <= 0 ? 'empty' : u >= 1 ? 'full' : 'live'
      if (state !== 'live' && s.state === state) continue
      s.state = state
      if (u <= 0) {
        s.poly.setAttribute('points', '')
        s.cap.setAttribute('r', '0')
        continue
      }
      const f = progressAt(s.st, u)
      const head = pairAt(s.st, f)
      const c = pointAt(s.st, f)
      s.poly.setAttribute('points', inkPolygon(s.st, f))
      s.cap.setAttribute('cx', String(c[0]))
      s.cap.setAttribute('cy', String(c[1]))
      s.cap.setAttribute(
        'r',
        String(u >= 1 ? 0 : Math.hypot(head[0][0] - head[1][0], head[0][1] - head[1][1]) / 2 + 30),
      )
    }
    if (done) L.g.removeAttribute('mask')
    else L.g.setAttribute('mask', `url(#guide-l${L.g.dataset.letter})`)
  }
}

let raf = 0
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** 点击品牌可重播，减少动态效果时直接显示完成态。 */
function play() {
  cancelAnimationFrame(raf)
  if (reduceMotion()) {
    render(TIMELINE.total)
    return
  }
  const t0 = performance.now()
  const step = (now: number) => {
    const t = Math.min(TIMELINE.total, now - t0)
    render(t)
    if (t < TIMELINE.total) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => {
  if (!stage.value) return
  parts = collect(stage.value)
  render(reduceMotion() ? TIMELINE.total : 0)
  play()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
<template>
  <button ref="stage" class="brand-writing" type="button" aria-label="重播品牌书写动画" @click="play">
    <span class="pair">
      <svg class="mark" viewBox="150 100 815 1050" aria-hidden="true">
        <defs>
          <mask id="guide-ink" maskUnits="userSpaceOnUse" x="300" y="830" width="700" height="350">
            <polygon data-about="ink-poly" class="ink ink-m" points="" />
            <circle data-about="ink-cap" class="ink" r="0" />
          </mask>
        </defs>
        <g data-about="m" mask="url(#guide-ink)">
          <path v-for="(p, i) in art.m" :key="i" :d="p.d" :transform="`translate(${p.x},${p.y})`" />
        </g>
        <g data-about="pen">
          <path v-for="(p, i) in art.pen" :key="i" :d="p.d" :transform="`translate(${p.x},${p.y})`" />
        </g>
      </svg>
      <svg class="name" viewBox="0 0 17430 2900" aria-hidden="true">
        <defs>
          <mask
            v-for="(L, i) in art.letters"
            :id="`guide-l${i}`"
            :key="i"
            maskUnits="userSpaceOnUse"
            :x="L.box[0] - 150"
            :y="L.box[1] - 150"
            :width="L.box[2] + 300"
            :height="L.box[3] + 300"
          >
            <g v-for="(_, k) in LETTER_STROKES[i]" :key="k" :data-stroke="`${i}-${k}`">
              <polygon class="ink ink-text" points="" />
              <circle class="ink" r="0" />
            </g>
          </mask>
        </defs>
        <g v-for="(L, i) in art.letters" :key="i" :data-letter="i" :mask="`url(#guide-l${i})`">
          <path :d="L.outline" />
        </g>
      </svg>
    </span>
  </button>
</template>
<style scoped>
.brand-writing {
  height: auto;
  padding: var(--sp-2);
  border: 0;
  color: var(--fg);
  background: transparent;
}
.brand-writing:hover:not(:disabled) {
  background: transparent;
}
.pair {
  display: flex;
  align-items: end;
  justify-content: center;
  gap: var(--sp-4);
}
.mark {
  width: 72px;
  height: 93px;
  overflow: visible;
}
.name {
  width: 252px;
  height: 42px;
  overflow: visible;
}
svg path {
  fill: currentColor;
  stroke: currentColor;
  stroke-width: 9;
  stroke-linejoin: round;
}
.ink {
  fill: white;
  stroke: white;
  stroke-width: 10;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ink-m {
  stroke-width: 40;
}
.ink-text {
  stroke-width: 60;
}
</style>
