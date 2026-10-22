import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { current, dismiss, toast, TOAST_ACTION_MS, TOAST_MS } from './useToast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    current.value = null
  })

  it('显示一条提示，过一会儿自己消失', () => {
    toast('已保存。')
    expect(current.value?.text).toBe('已保存。')
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(current.value).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(current.value).toBeNull()
  })

  it('接连来两条：后一条顶替前一条，并重新计时', () => {
    toast('第一条。')
    vi.advanceTimersByTime(TOAST_MS - 100)
    toast('第二条。')
    expect(current.value?.text).toBe('第二条。')
    vi.advanceTimersByTime(TOAST_MS - 100)
    expect(current.value?.text).toBe('第二条。')
    vi.advanceTimersByTime(200)
    expect(current.value).toBeNull()
  })
})

describe('带按钮的提示（撤销）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    dismiss()
  })

  it('带按钮的提示多留一会儿，给用户时间点“撤销”', () => {
    toast('已删除领域「健身」。', { action: { label: '撤销', run: () => {} } })
    expect(current.value?.action?.label).toBe('撤销')
    vi.advanceTimersByTime(TOAST_MS + 100)
    expect(current.value).not.toBeNull()
    vi.advanceTimersByTime(TOAST_ACTION_MS)
    expect(current.value).toBeNull()
  })

  it('dismiss 马上收起提示', () => {
    toast('x。')
    dismiss()
    expect(current.value).toBeNull()
  })
})
