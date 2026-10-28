// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import CopyErrorButton from './CopyErrorButton.vue'
import { toast } from './useToast'
vi.mock('./useToast', () => ({ toast: vi.fn() }))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it.each([true, false])('复制技术原文并提示结果（成功：%s）', async (success) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const writeText = success ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('denied'))
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(CopyErrorButton, { detail: 'HTTP 500 provider diagnostic' })
  app.mount(root)
  const button = root.querySelector('button')
  if (!button) throw new Error('缺少复制按钮')
  button.click()
  await nextTick()
  await nextTick()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('HTTP 500 provider diagnostic')
  if (success) expect(toast).toHaveBeenCalledExactlyOnceWith('已复制，反馈问题时可以粘贴给作者。')
  else expect(toast).toHaveBeenCalledExactlyOnceWith('复制失败，请稍后重试。', { kind: 'error' })
})
