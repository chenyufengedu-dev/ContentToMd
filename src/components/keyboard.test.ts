// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import NoticeDialog from './NoticeDialog.vue'
import SelectBox from './SelectBox.vue'
import CropDialog from './CropDialog.vue'

let app: App
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() })),
  })
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'animate')
})
function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({ render })
  app.mount(root)
  return root
}
function key(el: Element, name: string, options: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
  el.dispatchEvent(e)
  return e
}
function required<T extends Element>(selector: string, root: ParentNode = document) {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`缺少控件 ${selector}`)
  return el
}
it('弹窗聚焦内部，Tab 循环，阻止后台快捷键，关闭后恢复原焦点', async () => {
  const open = ref(false)
  const shortcut = vi.fn()
  window.addEventListener('keydown', shortcut)
  try {
    mount(() =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, '打开'),
        open.value
          ? h(NoticeDialog, { title: '提示', cancelText: '取消', okText: '确定', onCancel: () => (open.value = false) })
          : null,
      ]),
    )
    const opener = required<HTMLButtonElement>('#opener')
    opener.focus()
    opener.click()
    await nextTick()
    const cancel = required<HTMLButtonElement>('.dialog button.soft')
    const ok = required<HTMLButtonElement>('.dialog button.primary')
    expect(document.activeElement).toBe(cancel)
    key(cancel, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(ok)
    key(ok, 'Tab')
    expect(document.activeElement).toBe(cancel)
    expect(key(cancel, 's', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(shortcut).not.toHaveBeenCalled()
    opener.focus()
    expect(required('.dialog').contains(document.activeElement)).toBe(true)
    key(cancel, 'Escape')
    await nextTick()
    expect(document.querySelector('.dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  } finally {
    window.removeEventListener('keydown', shortcut)
  }
})
it('并存弹窗只有最上层处理 Esc，标题关联各自独立', async () => {
  const first = vi.fn()
  const second = vi.fn()
  mount(() =>
    h('div', [
      h(NoticeDialog, { title: '第一层', cancelText: '取消', okText: '确定', onCancel: first }),
      h(NoticeDialog, { title: '第二层', cancelText: '取消', okText: '确定', onCancel: second }),
    ]),
  )
  await nextTick()
  const dialogs = document.querySelectorAll('.dialog')
  expect(dialogs[0].getAttribute('aria-labelledby')).not.toBe(dialogs[1].getAttribute('aria-labelledby'))
  key(required('button', dialogs[1]), 'Escape')
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
})
it('下拉框保持触发器焦点并关联活动选项，Tab 关闭且不拦截默认跳转', async () => {
  const value = ref(1)
  mount(() =>
    h(SelectBox, {
      ariaLabel: '测试领域',
      options: [
        { value: 1, label: '一' },
        { value: 2, label: '二' },
      ],
      modelValue: value.value,
      'onUpdate:modelValue': (v) => (value.value = Number(v)),
    }),
  )
  const trigger = required<HTMLButtonElement>('.trigger')
  trigger.focus()
  key(trigger, 'ArrowDown')
  await nextTick()
  const menu = required('[role="listbox"]')
  expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
  key(trigger, 'End')
  await nextTick()
  expect(document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('二')
  expect(document.activeElement).toBe(trigger)
  expect(key(trigger, 'Tab').defaultPrevented).toBe(false)
  await nextTick()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  expect(trigger.hasAttribute('aria-activedescendant')).toBe(false)
  expect(value.value).toBe(1)
})
it('空下拉框不产生非法选择', async () => {
  const changed = vi.fn()
  mount(() => h(SelectBox, { ariaLabel: '空列表', options: [], modelValue: '', 'onUpdate:modelValue': changed }))
  const trigger = required<HTMLButtonElement>('.trigger')
  key(trigger, 'Enter')
  await nextTick()
  key(trigger, 'ArrowDown')
  key(trigger, 'Enter')
  expect(changed).not.toHaveBeenCalled()
})
it('下拉框鼠标选择后焦点回到触发器，失焦自动关闭', async () => {
  const value = ref(1)
  mount(() =>
    h('div', [
      h(SelectBox, {
        ariaLabel: '领域',
        options: [
          { value: 1, label: '一' },
          { value: 2, label: '二' },
        ],
        modelValue: value.value,
        'onUpdate:modelValue': (v) => (value.value = Number(v)),
      }),
      h('button', { class: 'outside' }, '外部'),
    ]),
  )
  const trigger = required<HTMLButtonElement>('.trigger')
  trigger.click()
  await nextTick()
  const second = document.querySelectorAll<HTMLElement>('[role="option"]')[1]
  second.click()
  await nextTick()
  expect(value.value).toBe(2)
  expect(document.activeElement).toBe(trigger)
  trigger.click()
  await nextTick()
  required<HTMLButtonElement>('.outside').focus()
  await nextTick()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
})
it('裁剪手柄可键盘缩放和移动，边界受限，完成才提交', async () => {
  const done = vi.fn()
  const original = { x: 40, y: 30, w: 200, h: 150 }
  mount(() => h(CropDialog, { images: [{ url: 'blob:isolated', crop: original }], start: 0, onDone: done }))
  const stage = required('.stage')
  Object.defineProperties(stage, { clientWidth: { value: 600 }, clientHeight: { value: 500 } })
  const img = required<HTMLImageElement>('.frame img')
  Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  img.dispatchEvent(new Event('load'))
  await nextTick()
  const left = required<HTMLButtonElement>('[aria-label="调整左边界"]')
  expect(left.tabIndex).toBe(0)
  key(left, 'ArrowRight', { shiftKey: true })
  await nextTick()
  const move = required<HTMLButtonElement>('[aria-label="移动裁剪框"]')
  key(move, 'ArrowDown')
  await nextTick()
  expect(original).toEqual({ x: 40, y: 30, w: 200, h: 150 })
  expect(done).not.toHaveBeenCalled()
  required<HTMLButtonElement>('.buttons .primary').click()
  expect(done).toHaveBeenCalledWith([{ x: 50, y: 31, w: 190, h: 150 }])
  for (let i = 0; i < 50; i++) key(left, 'ArrowRight', { shiftKey: true })
  await nextTick()
  required<HTMLButtonElement>('.buttons .primary').click()
  expect(done.mock.lastCall?.[0][0].w).toBe(24)
})
