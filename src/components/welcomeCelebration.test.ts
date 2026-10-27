// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  hasWelcomeCelebrationPlayed,
  markWelcomeCelebrationPlayed,
  resetWelcomeCelebrationPreview,
} from '../../dev/welcomeCelebration'
beforeEach(resetWelcomeCelebrationPreview)
afterEach(() => {
  vi.restoreAllMocks()
  resetWelcomeCelebrationPreview()
})
it('原型读取不消耗机会，播放记录跨模块重开保留', async () => {
  expect(hasWelcomeCelebrationPlayed()).toBe(false)
  expect(hasWelcomeCelebrationPlayed()).toBe(false)
  markWelcomeCelebrationPlayed()
  vi.resetModules()
  const reopened = await import('../../dev/welcomeCelebration')
  expect(reopened.hasWelcomeCelebrationPlayed()).toBe(true)
})
it('原型禁止持久化时仍允许首次体验，会话内不重播', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(hasWelcomeCelebrationPlayed()).toBe(false)
  markWelcomeCelebrationPlayed()
  expect(hasWelcomeCelebrationPlayed()).toBe(true)
})
it('原型显式重置才清除播放记录', () => {
  markWelcomeCelebrationPlayed()
  resetWelcomeCelebrationPreview()
  expect(hasWelcomeCelebrationPlayed()).toBe(false)
})
