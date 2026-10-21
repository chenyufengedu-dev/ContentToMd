import { describe, expect, it } from 'vitest'
import { autoCrop, checkImages, regionToRect, trimUniformEdges, MAX_IMAGES, MAX_IMAGE_BYTES } from './image'

/** 造一张 RGBA 图：整张填 bg，再在 rect 里填 fg */
function img(w: number, h: number, bg: number[], fg?: { x: number; y: number; w: number; h: number; c: number[] }) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inFg = fg && x >= fg.x && x < fg.x + fg.w && y >= fg.y && y < fg.y + fg.h
      d.set(inFg ? fg.c : bg, (y * w + x) * 4)
    }
  return { data: d, width: w, height: h }
}
const WHITE = [255, 255, 255, 255]
const RED = [200, 30, 30, 255]

describe('trimUniformEdges', () => {
  it('去掉四周的纯色边，留下主体', () => {
    const im = img(100, 80, WHITE, { x: 10, y: 20, w: 50, h: 30, c: RED })
    expect(trimUniformEdges(im, { x: 0, y: 0, w: 100, h: 80 })).toEqual({ x: 10, y: 20, w: 50, h: 30 })
  })

  it('只在给定的区域里找', () => {
    const im = img(100, 80, WHITE, { x: 10, y: 20, w: 50, h: 30, c: RED })
    expect(trimUniformEdges(im, { x: 30, y: 0, w: 70, h: 80 })).toEqual({ x: 30, y: 20, w: 30, h: 30 })
  })

  it('接近纯色（有轻微噪点）也算纯色边', () => {
    const im = img(40, 40, [250, 250, 250, 255], { x: 5, y: 5, w: 30, h: 30, c: RED })
    im.data.set([244, 252, 247, 255], 0) // 左上角一个略有差异的点
    expect(trimUniformEdges(im, { x: 0, y: 0, w: 40, h: 40 })).toEqual({ x: 5, y: 5, w: 30, h: 30 })
  })

  it('整张都是纯色时不裁', () => {
    const im = img(30, 30, WHITE)
    expect(trimUniformEdges(im, { x: 0, y: 0, w: 30, h: 30 })).toEqual({ x: 0, y: 0, w: 30, h: 30 })
  })
})

describe('regionToRect', () => {
  it('把 AI 给的比例换成像素，并限制在图内', () => {
    expect(regionToRect([0.1, 0.2, 0.5, 0.5], 1000, 2000)).toEqual({ x: 100, y: 400, w: 500, h: 1000 })
    expect(regionToRect([0.5, 0.5, 0.9, 0.9], 100, 100)).toEqual({ x: 50, y: 50, w: 50, h: 50 })
  })

  it('格式不对、太小时不用', () => {
    expect(regionToRect(undefined, 100, 100)).toBeNull()
    expect(regionToRect([0.1, 0.1, 'x', 0.5], 100, 100)).toBeNull()
    expect(regionToRect([0, 0, 0.1, 0.1], 100, 100)).toBeNull() // 不到整张的 5%
  })
})

describe('autoCrop', () => {
  it('先用 AI 给的主体区域，再去掉区域里的纯色边', () => {
    // 顶部 10 行是“状态栏”（红色），下面白底上有一块主体
    const im = img(100, 100, WHITE, { x: 0, y: 0, w: 100, h: 10, c: RED })
    for (let y = 40; y < 70; y++) for (let x = 20; x < 80; x++) im.data.set([20, 20, 20, 255], (y * 100 + x) * 4)
    expect(autoCrop(im, [0, 0.15, 1, 0.85])).toEqual({ x: 20, y: 40, w: 60, h: 30 })
  })

  it('没有 AI 区域时只去纯色边', () => {
    const im = img(50, 50, WHITE, { x: 5, y: 5, w: 10, h: 10, c: RED })
    expect(autoCrop(im, undefined)).toEqual({ x: 5, y: 5, w: 10, h: 10 })
  })

  it('裁完几乎没变时返回 null，表示不用裁', () => {
    const im = img(50, 50, RED)
    expect(autoCrop(im, undefined)).toBeNull()
  })
})

describe('checkImages', () => {
  const f = (name: string, size: number, type = 'image/png') => ({ name, size, type })

  it('超过张数和大小的部分不加入，并说明原因', () => {
    const existing = Array.from({ length: MAX_IMAGES - 1 }, (_, i) => f(`a${i}.png`, 10))
    const r = checkImages(existing.length, [f('big.png', MAX_IMAGE_BYTES + 1), f('ok.png', 10), f('more.png', 10)])
    expect(r.accepted.map((x) => x.name)).toEqual(['ok.png'])
    expect(r.rejected).toEqual([
      { name: 'big.png', reason: '超过 20MB' },
      { name: 'more.png', reason: '一次最多 9 张' },
    ])
  })

  it('不是图片的文件不收', () => {
    const r = checkImages(0, [f('a.txt', 10, 'text/plain')])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0].reason).toBe('不是图片')
  })
})
