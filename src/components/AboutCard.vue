<script setup lang="ts">
// 设置页最下面“关于”卡片的内容，放在 SettingCard 里：
// 收起时一行：小图标、软件名、版本号，右边作者和链接；
// 展开时左右两栏：左边图标和软件名并排（羽毛笔写出 M，接着写出软件名），右边介绍、链接、版本和开源致谢。
// 每次展开都在卡片展开动画结束后写一遍；点左边的图标或软件名重播；系统开了“减少动态效果”时直接显示写好的样子。
// 动画数据在 about-art.json，计算在 aboutWriting.ts。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import art from '../assets/about-art.json'
import { appVersion, openLink } from '../shell/tauri'
import { toast } from './useToast'
import { ChevronRight, Github, Link2, MessageCircleMore, User } from './icons'
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
} from './aboutWriting'

const props = defineProps<{ open: boolean }>()

const AUTHOR = 'ChenyuFeng'
const BLOG_URL = 'https://chenyu-blog.vercel.app/'
/** 项目仓库地址：仓库建好后换成真正的地址 */
const GITHUB_URL = 'https://github.com/'
/** 反馈先去博客；仓库建好后改成仓库的问题页 */
const FEEDBACK_URL = BLOG_URL
/** 用到的主要开源项目、许可证和仓库地址（地址取自各依赖自己声明的 repository） */
const CREDITS = [
  { name: 'Tauri', license: 'MIT / Apache-2.0', url: 'https://github.com/tauri-apps/tauri' },
  { name: 'Vue', license: 'MIT', url: 'https://github.com/vuejs/core' },
  { name: 'Tiptap', license: 'MIT', url: 'https://github.com/ueberdosis/tiptap' },
  { name: 'pdf.js', license: 'Apache-2.0', url: 'https://github.com/mozilla/pdf.js' },
  { name: 'mammoth', license: 'BSD-2-Clause', url: 'https://github.com/mwilliamson/mammoth.js' },
  { name: 'zod', license: 'MIT', url: 'https://github.com/colinhacks/zod' },
  { name: 'Motion', license: 'MIT', url: 'https://github.com/motiondivision/motion' },
  { name: 'Lucide', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
  { name: 'trash', license: 'MIT', url: 'https://github.com/ArturKovacs/trash' },
  { name: 'gray_matter', license: 'MIT', url: 'https://github.com/the-alchemists-of-arland/gray-matter-rs' },
]
/** 链接：收起时放作者、博客、GitHub；展开时再加反馈 */
const LINKS = [
  { key: 'author', icon: User, text: AUTHOR, url: '', onlyOpen: false },
  { key: 'blog', icon: Link2, text: '个人博客', url: BLOG_URL, onlyOpen: false },
  { key: 'github', icon: Github, text: 'GitHub', url: GITHUB_URL, onlyOpen: false },
  { key: 'feedback', icon: MessageCircleMore, text: '反馈问题', url: FEEDBACK_URL, onlyOpen: true },
]

const version = ref('')
const showCredits = ref(false)
const creditsMounted = ref(false)
const creditsEl = ref<HTMLElement>()
let creditsAnim: Animation | null = null
let creditsRun = 0
/** 目标状态立即切换；离场节点等动画结束再移除，允许中途反向。 */
async function toggleCredits() {
  const id = ++creditsRun
  const current = creditsEl.value
  const height = current?.getBoundingClientRect().height ?? 0
  const opacity = current ? getComputedStyle(current).opacity || '1' : '0'
  creditsAnim?.cancel()
  creditsAnim = null
  const opening = !showCredits.value
  showCredits.value = opening
  if (opening) creditsMounted.value = true
  await nextTick()
  if (id !== creditsRun) return
  const el = creditsEl.value
  if (!el || reduceMotion()) {
    creditsMounted.value = opening
    return
  }
  creditsAnim = el.animate(
    [
      { height: `${height}px`, opacity },
      { height: opening ? `${el.scrollHeight}px` : '0px', opacity: opening ? 1 : 0 },
    ],
    { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  )
  creditsAnim.onfinish = () => {
    if (id !== creditsRun) return
    creditsAnim = null
    creditsMounted.value = opening
  }
}
function resetCredits() {
  creditsRun++
  creditsAnim?.cancel()
  creditsAnim = null
  showCredits.value = false
  creditsMounted.value = false
}
appVersion()
  .then((v) => (version.value = v))
  .catch(() => {
    // 浏览器预览里没有外壳，读不到版本号就不显示
  })

async function visit(url: string) {
  try {
    await openLink(url)
  } catch (e) {
    toast(String(e), { kind: 'error' })
  }
}

// ---- 书写动画 ----
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
  fades: HTMLElement[]
}
const stage = ref<HTMLElement>()
let parts: Parts | null = null

/** 取模板里自己画的元素；取不到说明模板和这里对不上，直接报错 */
function must<T extends Element>(el: HTMLElement, sel: string): T {
  const node = el.querySelector<T>(sel)
  if (!node) throw new Error(`关于卡片缺少元素：${sel}`)
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
    fades: [...el.querySelectorAll<HTMLElement>('[data-fade]')],
  }
}

/** 画出第 t 毫秒的样子；withInfo 为 false 时右栏保持完成的样子（只重播左边） */
function render(t: number, withInfo = true) {
  if (!parts) return
  const { pen, inkPoly, inkCap, letters, fades } = parts
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
    else L.g.setAttribute('mask', `url(#about-l${L.g.dataset.letter})`)
  }

  // 右栏的介绍、链接、版本不等左边写完：一开始就依次轻轻上浮出现
  fades.forEach((el, i) => {
    const p = withInfo ? easeOut(clamp((t - (100 + i * 90)) / 320, 0, 1)) : 1
    el.style.opacity = String(p)
    el.style.transform = p < 1 ? `translateY(${((1 - p) * 6).toFixed(2)}px)` : ''
  })
}

let raf = 0
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** withInfo：展开卡片时连同右栏一起出现；点左边的图标或软件名重播时只重写左边 */
function play(withInfo = true) {
  cancelAnimationFrame(raf)
  if (reduceMotion()) {
    render(TIMELINE.total)
    return
  }
  const t0 = performance.now()
  const step = (now: number) => {
    const t = Math.min(TIMELINE.total, now - t0)
    render(t, withInfo)
    if (t < TIMELINE.total) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

let run = 0
/** 展开时：先停在起笔帧，等卡片展开动画结束再写；收起时停下 */
watch(
  () => props.open,
  async (open) => {
    const focused = document.activeElement
    const focusKey =
      focused instanceof HTMLAnchorElement && focused.closest('.brief') ? focused.dataset.aboutLink : undefined
    const id = ++run
    cancelAnimationFrame(raf)
    parts = null
    resetCredits()
    if (!open) return
    await nextTick()
    if (id !== run || !stage.value) return
    parts = collect(stage.value)
    render(reduceMotion() ? TIMELINE.total : 0, !focusKey)
    if (focusKey) {
      // 两态节点会替换，把键盘焦点交还同名入口，右栏保持可见。
      const link = [...stage.value.querySelectorAll<HTMLAnchorElement>('[data-about-link]')].find(
        (el) => el.dataset.aboutLink === focusKey,
      )
      link?.focus({ preventScroll: true })
    }
    const card = stage.value.closest('[data-card]')
    if (card) await Promise.allSettled(card.getAnimations({ subtree: true }).map((a) => a.finished))
    if (id === run) play(!focusKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  run++
  resetCredits()
  cancelAnimationFrame(raf)
})
</script>

<template>
  <!-- 收起：一行 -->
  <div v-if="!open" class="brief">
    <span class="lockup small">
      <svg class="mark" viewBox="150 100 815 1050" aria-hidden="true">
        <path v-for="(p, i) in art.m" :key="`m${i}`" :d="p.d" :transform="`translate(${p.x},${p.y})`" />
        <path v-for="(p, i) in art.pen" :key="`p${i}`" :d="p.d" :transform="`translate(${p.x},${p.y})`" />
      </svg>
      <svg class="name" viewBox="0 0 17430 2900" role="img" aria-label="ContentToMd">
        <path v-for="(L, i) in art.letters" :key="i" :d="L.outline" />
      </svg>
    </span>
    <span v-if="version" class="ver">v{{ version }}</span>
    <ul class="links" aria-label="作者与链接">
      <template v-for="l in LINKS" :key="l.key">
        <li v-if="!l.onlyOpen" class="link">
          <component :is="l.icon" :size="16" outline aria-hidden="true" />
          <a v-if="l.url" :data-about-link="l.key" :href="l.url" @click.stop.prevent="visit(l.url)">{{ l.text }}</a>
          <span v-else>{{ l.text }}</span>
        </li>
      </template>
    </ul>
  </div>

  <!-- 展开：左边图标和软件名书写，右边信息 -->
  <div v-else ref="stage" class="full">
    <button class="lockup big" type="button" aria-label="ContentToMd，点击重播书写动画" @click.stop="play(false)">
      <span class="pair">
        <svg class="mark" viewBox="150 100 815 1050" aria-hidden="true">
          <defs>
            <mask id="about-ink" maskUnits="userSpaceOnUse" x="300" y="830" width="700" height="350">
              <polygon data-about="ink-poly" class="ink ink-m" points="" />
              <circle data-about="ink-cap" class="ink" r="0" />
            </mask>
          </defs>
          <g data-about="m" mask="url(#about-ink)">
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
              :id="`about-l${i}`"
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
          <g v-for="(L, i) in art.letters" :key="i" :data-letter="i" :mask="`url(#about-l${i})`">
            <path :d="L.outline" />
          </g>
        </svg>
      </span>
    </button>
    <div class="info">
      <p class="tag" data-fade>把值得收藏的内容，整理成自己的笔记。</p>
      <ul class="links" data-fade aria-label="作者与链接">
        <li v-for="l in LINKS" :key="l.key" class="link">
          <component :is="l.icon" :size="16" outline aria-hidden="true" />
          <a v-if="l.url" :data-about-link="l.key" :href="l.url" @click.stop.prevent="visit(l.url)">{{ l.text }}</a>
          <span v-else>{{ l.text }}</span>
        </li>
      </ul>
      <p class="meta" data-fade>
        <span v-if="version">版本 {{ version }}</span>
        <button type="button" class="credits-btn" :aria-expanded="showCredits" @click.stop="toggleCredits">
          开源致谢<ChevronRight class="chev" :class="{ on: showCredits }" :size="14" aria-hidden="true" />
        </button>
      </p>
      <p
        v-if="creditsMounted"
        ref="creditsEl"
        class="credits"
        :inert="showCredits ? undefined : true"
        :aria-hidden="!showCredits"
      >
        <a v-for="c in CREDITS" :key="c.name" :href="c.url" @click.stop.prevent="visit(c.url)"
          >{{ c.name }}（{{ c.license }}）</a
        >
      </p>
    </div>
  </div>
</template>

<style scoped>
/* ---- 图标加软件名（两种状态共用） ---- */
.lockup {
  display: inline-flex;
  align-items: center;
  color: var(--primary);
}
.lockup svg {
  display: block;
  overflow: visible;
}
.lockup path {
  fill: currentColor;
}
.mark path {
  stroke: currentColor;
  stroke-width: 9;
  stroke-linejoin: round;
}

/* ---- 收起 ---- */
.brief {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-height: 100%;
}
.small {
  gap: var(--sp-2);
}
.small .mark {
  width: 20px;
  height: 26px;
}
.small .name {
  width: 108px;
  height: 18px;
}
.ver {
  padding: 1px var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--muted);
  background: var(--hover);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}
.brief .links {
  margin-left: auto;
}

/* ---- 链接（两种状态共用）：灰色图标加文字，悬停变强调色 ---- */
.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-md);
  color: var(--muted);
}
.link a {
  color: inherit;
  text-decoration: none;
}
.link:has(a:hover) {
  color: var(--accent);
}

/* ---- 展开 ---- */
.full {
  display: flex;
  align-items: stretch; /* 分隔线撑满整个内容高度 */
}
.big {
  flex: none;
  gap: var(--sp-4);
  /* 起笔时羽毛笔在 M 的起点，比写完时偏左约 35px，左边留出这段距离 */
  padding: 0 var(--sp-7);
  border: 0;
  height: auto; /* 不用全局按钮的固定高度，跟着内容撑满，分隔线才能到底 */
  border-right: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
}
/* 图标和软件名不是普通操作按钮，不用全局按钮的悬停底块 */
.big:hover:not(:disabled),
.big:active:not(:disabled) {
  background: transparent;
  box-shadow: none;
}
.big:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: var(--sp-1);
}
.pair {
  display: inline-flex;
  align-items: center; /* 和图标上下居中；图标的重心在下方的 M，名字再往下挪一点 */
  gap: var(--sp-4);
}
.big .mark {
  width: 48px;
  height: 62px;
}
.big .name {
  width: 168px;
  height: 28px;
  margin-top: var(--sp-2);
}
.ink {
  fill: #fff; /* 遮罩里白色＝露出，不是界面颜色 */
  stroke: #fff;
  stroke-width: 10;
  stroke-linejoin: round;
}
.ink-m {
  /* 覆盖原M描边及抗锯齿边缘；仍由原轮廓限定实际墨迹。 */
  stroke-width: 40;
}
.ink-text {
  stroke-width: 60;
}
.info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--sp-3);
  min-width: 0;
  padding-left: var(--sp-7);
}
.tag,
.meta,
.credits {
  margin: 0;
}
.tag {
  font-size: var(--fs-md);
  color: var(--muted);
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  font-size: var(--fs-sm);
  color: var(--muted);
}
.credits-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: auto; /* 不用全局按钮的固定高度，否则这一行比上面几行间距大 */
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.credits-btn:focus {
  outline: none;
}
.credits-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.credits-btn:hover:not(:disabled) {
  background: transparent;
  color: var(--accent);
}
.chev {
  transition: transform var(--ease);
}
.chev.on {
  transform: rotate(90deg);
}
.credits {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-4);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--muted);
  overflow: hidden; /* 展开动画时高度从 0 长出来，内容不溢出 */
}
.credits a {
  color: inherit;
  text-decoration: none;
}
.credits a:hover {
  color: var(--accent);
}
</style>
