import { beforeEach, describe, expect, it, vi } from 'vitest'

type CloseHandler = (e: { preventDefault: () => void }) => void
let handlers: CloseHandler[] = []
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: CloseHandler) => {
      handlers.push(h)
      return () => {}
    },
  }),
}))

describe('guardClose', () => {
  beforeEach(() => {
    handlers = []
    vi.resetModules()
  })

  // Tauri 里每个关闭监听在自己没拦下时都会直接关窗口，所以只能向 Tauri 注册一个监听，多个页面的询问由它统一判断
  it('多个页面各自登记也只向窗口注册一个监听，任何一个要问就拦下并只问它', async () => {
    const { guardClose } = await import('./tauri')
    const askA = vi.fn()
    const askB = vi.fn()
    await guardClose(() => false, askA)
    await guardClose(() => true, askB)
    expect(handlers).toHaveLength(1)
    const e = { preventDefault: vi.fn() }
    handlers[0](e)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(askA).not.toHaveBeenCalled()
    expect(askB).toHaveBeenCalledTimes(1)
  })

  it('都不用问时不拦', async () => {
    const { guardClose } = await import('./tauri')
    await guardClose(() => false, vi.fn())
    const e = { preventDefault: vi.fn() }
    handlers[0](e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('取消登记后不再询问', async () => {
    const { guardClose } = await import('./tauri')
    const ask = vi.fn()
    const off = await guardClose(() => true, ask)
    off()
    const e = { preventDefault: vi.fn() }
    handlers[0](e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })
})
