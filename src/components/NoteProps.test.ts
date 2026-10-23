// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import NoteProps from './NoteProps.vue'
import { defaultConfig } from '../core/config'

let app: App
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const values = reactive<{ tags: string[]; keywords: string[] }>({ tags: [], keywords: [] })
  const root = document.createElement('div')
  document.body.append(root)
  const config = defaultConfig()
  app = createApp({
    render: () =>
      h(NoteProps, {
        domains: config.domains,
        existingTags: [],
        domainId: 1,
        tags: values.tags,
        keywords: values.keywords,
        'onUpdate:tags': (v: string[]) => (values.tags = v),
        'onUpdate:keywords': (v: string[]) => (values.keywords = v),
      }),
  })
  app.mount(root)
  async function add(label: string) {
    const button = root.querySelector<HTMLButtonElement>(`[aria-label="添加${label}"]`)
    if (!button) throw new Error('缺少添加按钮')
    button.click()
    await nextTick()
    const input = root.querySelector<HTMLInputElement>(`[aria-label="新${label}"]`)
    if (!input) throw new Error('缺少新增输入框')
    return input
  }
  return { values, add }
}
it.each(['标签', '关键词'])('新增%s自动聚焦，回车后失焦只提交到原字段一次', async (label) => {
  const { values, add } = await mount()
  const input = await add(label)
  expect(document.activeElement).toBe(input)
  input.value = '测试输入'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  input.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  expect(values.tags).toEqual(label === '标签' ? ['测试输入'] : [])
  expect(values.keywords).toEqual(label === '关键词' ? ['测试输入'] : [])
})
it('取消标签输入后失焦不提交', async () => {
  const { values, add } = await mount()
  const input = await add('标签')
  input.value = '不应加入'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
  input.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  expect(values.tags).toEqual([])
  expect(values.keywords).toEqual([])
})
it('切换新增字段后继续正确聚焦，失焦按分隔符去重加入', async () => {
  const { values, add } = await mount()
  const tag = await add('标签')
  tag.value = '提示词，提示词、收藏'
  tag.dispatchEvent(new Event('input', { bubbles: true }))
  tag.blur()
  await nextTick()
  const keyword = await add('关键词')
  expect(document.activeElement).toBe(keyword)
  keyword.value = '检索词'
  keyword.dispatchEvent(new Event('input', { bubbles: true }))
  keyword.blur()
  await nextTick()
  expect(values.tags).toEqual(['提示词', '收藏'])
  expect(values.keywords).toEqual(['检索词'])
})
