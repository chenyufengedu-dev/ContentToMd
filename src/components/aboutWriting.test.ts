import { describe, expect, it } from 'vitest'
import { inkPolygon, makeStroke, pointAt, progressAt, TIMELINE, tiltCurve } from './aboutWriting'

// 一段先向右、再向上折的笔画：截面是笔画两侧的边缘点，间距 2，和真实数据的密度相近
const pairs: [number, number][][] = []
for (let x = 0; x <= 120; x += 2)
  pairs.push([
    [x, -4],
    [x, 4],
  ])
for (let y = -2; y >= -120; y -= 2)
  pairs.push([
    [116, y],
    [124, y],
  ])
const CORNER = 60 // 折角处的截面序号

describe('关于卡片的书写计算', () => {
  const st = makeStroke(pairs)

  it('起点和终点：时间 0 在第一个截面，时间 1 在最后一个截面', () => {
    expect(progressAt(st, 0)).toBe(0)
    expect(progressAt(st, 1)).toBe(st.n - 1)
    expect(pointAt(st, progressAt(st, 1))).toEqual([120, -120])
  })

  it('写得越久走得越远，不会倒退', () => {
    let last = -1
    for (let u = 0; u <= 1; u += 0.05) {
      const f = progressAt(st, u)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
  })

  it('转折处比直线段慢：同样多的截面，走过折角要花更多时间', () => {
    const corner = st.rhythm[CORNER + 3] - st.rhythm[CORNER - 3]
    const straight = st.rhythm[33] - st.rhythm[27]
    expect(corner).toBeGreaterThan(straight * 1.5)
  })

  it('有预先算好的节奏表时直接用它', () => {
    const given = pairs.map((_, i) => i / (pairs.length - 1))
    expect(makeStroke(pairs, given).rhythm).toBe(given)
  })

  it('已写部分的外形：只包含走过的截面，前端是插值出来的截面', () => {
    const pts = inkPolygon(st, 1.5).split(' ')
    expect(pts).toEqual(['0.0,-4.0', '2.0,-4.0', '3.0,-4.0', '3.0,4.0', '2.0,4.0', '0.0,4.0'])
  })

  it('笔身俯仰在收笔时已回到 0，写完不再动', () => {
    const tilt = tiltCurve((t) => pointAt(st, progressAt(st, t / TIMELINE.mDur)))
    expect(tilt(TIMELINE.mStart)).toBe(0)
    expect(tilt(TIMELINE.mEnd)).toBeCloseTo(0, 10)
    expect(tilt(TIMELINE.mEnd + 500)).toBe(0)
  })
})
