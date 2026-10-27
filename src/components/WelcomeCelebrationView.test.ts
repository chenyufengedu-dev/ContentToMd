// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import WelcomeCelebration from './WelcomeCelebration.vue'
import confetti from 'canvas-confetti'

const mock = vi.hoisted(() => ({ fire: vi.fn(() => new Promise<void>(() => {})), reset: vi.fn() }))
vi.mock('canvas-confetti', () => ({
  default: { create: vi.fn(() => Object.assign(mock.fire, { reset: mock.reset })) },
}))
const frames: FrameRequestCallback[] = []
const played = vi.fn()
const finished = vi.fn()
let app: App | undefined
function mount(alreadyPlayed = false) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () => h(WelcomeCelebration, { played: alreadyPlayed, onPlayed: played, onFinished: finished }),
  })
  app.mount(host)
}
function frame() {
  frames.shift()?.(0)
}
beforeEach(() => {
  vi.clearAllMocks()
  frames.length = 0
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('首页绘制后才发射，礼花开始绘制后才记录；卸载清理', () => {
  mount()
  expect(mock.fire).not.toHaveBeenCalled()
  frame()
  expect(mock.fire).not.toHaveBeenCalled()
  frame()
  expect(mock.fire).toHaveBeenCalledTimes(2)
  expect(played).not.toHaveBeenCalled()
  frame()
  expect(played).toHaveBeenCalledTimes(1)
  app?.unmount()
  app = undefined
  expect(mock.reset).toHaveBeenCalledTimes(1)
})

it('后台不消耗，切回可见首页才开始', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  mount()
  expect(frames).toHaveLength(0)
  expect(played).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  frame()
  frame()
  frame()
  expect(mock.fire).toHaveBeenCalledTimes(2)
  expect(played).toHaveBeenCalledTimes(1)
})

it('系统减少动态效果时直接结束，不播放粒子', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  mount()
  frame()
  frame()
  expect(confetti.create).not.toHaveBeenCalled()
  expect(played).toHaveBeenCalledTimes(1)
  expect(finished).toHaveBeenCalledTimes(1)
})

it('播放途中离开再回来，已记录时不重播并直接结束', () => {
  mount(true)
  expect(mock.fire).not.toHaveBeenCalled()
  expect(finished).toHaveBeenCalledTimes(1)
  expect(frames).toHaveLength(0)
})
