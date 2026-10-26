import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import * as icons from './icons'

async function render(icon: Component, props: Record<string, unknown> = {}) {
  return renderToString(createSSRApp({ render: () => h(icon, props) }))
}

describe('图标', () => {
  const all = Object.entries(icons).filter(([, v]) => v)

  it('所有图标都是同一画法：18 格、读屏时忽略、按 size 设宽高', async () => {
    for (const [name, icon] of all) {
      const html = await render(icon as Component, { size: 14 })
      expect(html, name).toContain('<svg')
      expect(html, name).toContain('width="14"')
      expect(html, name).toContain('height="14"')
    }
    const own = await render(icons.Trash2)
    expect(own).toContain('viewBox="0 0 18 18"')
    expect(own).toContain('aria-hidden="true"')
    expect(own).toContain('width="16"')
  })

  it('调用处传的 class 和读屏文字能带上', async () => {
    const html = await render(icons.Plus, { class: 'edit-hint', 'aria-label': '添加' })
    expect(html).toContain('class="ai ai-mono edit-hint"')
    expect(html).toContain('aria-label="添加"')
  })

  it('深浅线图标里有浅色线条，单色图标没有', async () => {
    expect(await render(icons.Clock)).toContain('l2')
    expect(await render(icons.Trash2)).not.toContain('l2')
  })

  it('深浅线只在 20px 及以上的大图标里显示，小图标当单色', async () => {
    expect(await render(icons.Clock, { size: 16 })).toContain('class="ai ai-mono"')
    expect(await render(icons.Clock, { size: 19 })).toContain('class="ai ai-mono"')
    expect(await render(icons.Clock, { size: 20 })).toContain('class="ai"')
    expect(await render(icons.FilePlus2, { size: 48 })).toContain('class="ai"')
  })

  it('编辑提示可以在不同尺寸下明确保留深浅线', async () => {
    for (const size of [16, 20]) {
      const html = await render(icons.Pencil, { size, duotone: true })
      expect(html).toContain('class="ai"')
      expect(html).toContain(`width="${size}"`)
      expect(html).not.toContain('ai-mono')
    }
  })

  it('outline 只要线条：加上 ai-outline，不加就没有', async () => {
    expect(await render(icons.User, { outline: true })).toContain('ai-outline')
    expect(await render(icons.User)).not.toContain('ai-outline')
  })

  it('作者、话筒、音频、视频是四个不同的图标', async () => {
    const htmls = await Promise.all([icons.User, icons.Mic, icons.AudioLines, icons.Video].map((i) => render(i)))
    expect(new Set(htmls).size).toBe(4)
  })
})
