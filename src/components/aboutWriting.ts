// 关于卡片的书写动画：笔画按“截面”（笔画两侧的边缘点）一点点露出来，羽毛笔跟着笔尖走。
// 这里只放计算，不碰界面；AboutCard.vue 每帧调用它们去改 SVG 属性。

// 数据直接来自 JSON，所以点用普通数组表示（[x, y]），截面是 [左边缘点, 右边缘点]
export type Pt = number[]
export type Pair = Pt[]

/** 一段笔画：中线和“写到某个截面要用掉多少时间”的节奏表（0～1） */
export interface Stroke {
  pairs: Pair[]
  mid: Pt[]
  n: number
  rhythm: number[]
}

/** 时间表（毫秒）：落笔 → 写 M → M 写到 85% 时开始写软件名 → 介绍和作者信息浮现 */
export const TIMELINE = (() => {
  const land = 260
  const mStart = land + 90 // 笔尖碰到纸后停一下再出墨
  const mDur = 1100
  const textStart = mStart + mDur * 0.85
  const textDur = 2100
  return { land, mStart, mDur, mEnd: mStart + mDur, textStart, textDur, textEnd: textStart + textDur, total: 3800 }
})()

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** 转折处慢、直线段快，起笔和收笔放慢；given 是预先按完整数据算好的节奏表 */
export function makeStroke(pairs: Pair[], given?: number[]): Stroke {
  const mid = pairs.map(([a, b]): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  const n = mid.length
  if (given) return { pairs, mid, n, rhythm: given }
  const len = [0]
  const turn = [0]
  for (let i = 1; i < n; i++) len.push(Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]))
  for (let i = 1; i < n - 1; i++) {
    const a = Math.atan2(mid[i][1] - mid[i - 1][1], mid[i][0] - mid[i - 1][0])
    const b = Math.atan2(mid[i + 1][1] - mid[i][1], mid[i + 1][0] - mid[i][0])
    let d = Math.abs(b - a)
    if (d > Math.PI) d = 2 * Math.PI - d
    turn.push(d / Math.max(len[i], 1e-3))
  }
  turn.push(0)
  // 弯曲程度在前后 10 个截面内取平均，速度不会忽快忽慢
  const curv = turn.map((_, i) => {
    let s = 0
    let c = 0
    for (let j = i - 10; j <= i + 10; j++) {
      if (j >= 0 && j < n) {
        s += turn[j]
        c++
      }
    }
    return s / c
  })
  const acc = [0]
  for (let i = 1; i < n; i++) {
    const p = i / (n - 1)
    let v = 1 / (1 + 140 * curv[i])
    v *= 0.55 + 0.45 * Math.min(1, p / 0.07)
    v *= 0.55 + 0.45 * Math.min(1, (1 - p) / 0.08)
    acc.push(acc[i - 1] + len[i] / v)
  }
  return { pairs, mid, n, rhythm: acc.map((x) => x / acc[n - 1]) }
}

/** 归一化时间 u（0～1）写到第几个截面，带小数 */
export function progressAt(st: Stroke, u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return st.n - 1
  let lo = 0
  let hi = st.n - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (st.rhythm[m] <= u) lo = m
    else hi = m
  }
  return lo + (u - st.rhythm[lo]) / Math.max(st.rhythm[hi] - st.rhythm[lo], 1e-9)
}

export function pointAt(st: Stroke, f: number): Pt {
  const i = Math.floor(f)
  return i >= st.n - 1 ? st.mid[st.n - 1] : lerp(st.mid[i], st.mid[i + 1], f - i)
}

export function pairAt(st: Stroke, f: number): Pair {
  const i = Math.floor(f)
  if (i >= st.n - 1) return st.pairs[st.n - 1]
  return [lerp(st.pairs[i][0], st.pairs[i + 1][0], f - i), lerp(st.pairs[i][1], st.pairs[i + 1][1], f - i)]
}

/** 已写部分的外形（SVG polygon 的 points）：左边缘、前端截面、右边缘倒序 */
export function inkPolygon(st: Stroke, f: number): string {
  const head = pairAt(st, f)
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i <= Math.floor(f) && i < st.n; i++) {
    left.push(st.pairs[i][0])
    right.push(st.pairs[i][1])
  }
  left.push(head[0])
  right.push(head[1])
  return left
    .concat(right.reverse())
    .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ')
}

/** 笔杆方向：从笔尖指向羽毛（图标坐标），以及握笔处离笔尖的距离 */
const AXIS: Pt = (() => {
  const v: Pt = [560 - 950, 520 - 1073]
  const l = Math.hypot(v[0], v[1])
  return [v[0] / l, v[1] / l]
})()
const GRIP = 700

/**
 * 笔身俯仰：握笔处只平滑地跟着书写的大致高度（约 0.2 秒跟上），笔尖比它高或低时笔身轻轻点头，一两度。
 * 最后一笔的后 20% 里逐渐归零，墨迹写完时笔正好在原图标的位置。
 * nibAt 的参数是从开始写 M 算起的毫秒数；返回“从页面时间到角度（弧度）”的函数。查表，不在每帧重算。
 */
export function tiltCurve(nibAt: (msIntoM: number) => Pt): (t: number) => number {
  const { mStart, mDur, mEnd } = TIMELINE
  const step = 4
  const omega = 5
  const smooth: number[] = []
  let y = nibAt(0)[1]
  let v = 0
  for (let s = 0; s <= mDur; s += step) {
    const h = step / 1000
    v += (omega * omega * (nibAt(s)[1] - y) - 2 * omega * v) * h
    y += v * h
    smooth.push(y)
  }
  const base = Math.atan2(AXIS[1], AXIS[0])
  const fadeFrom = mStart + mDur * 0.8
  return (t) => {
    if (t <= mStart || t >= mEnd) return 0
    const i = Math.min(smooth.length - 1, (t - mStart) / step)
    const i0 = Math.floor(i)
    const ys = smooth[i0] + (smooth[Math.min(i0 + 1, smooth.length - 1)] - smooth[i0]) * (i - i0)
    const dy = (ys - nibAt(t - mStart)[1]) * 0.5
    const ang = Math.atan2(AXIS[1] * GRIP + dy, AXIS[0] * GRIP) - base
    return ang * (1 - easeInOut(clamp((t - fadeFrom) / (mEnd - fadeFrom), 0, 1)))
  }
}
