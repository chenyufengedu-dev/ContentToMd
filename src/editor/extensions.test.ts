// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions, fixCallouts } from './extensions'

const BODY = `### 一、摆正位置

- 尊重上级是天职，尊重平级是本分，尊重下级是美德。
- 一提到**尊重领导**就排斥反感，这是没有摆正位置。

### 二、端正态度

1. 态度不端正，影响的不只是职业发展。
2. 你以什么状态对待工作，它也像一面镜子回馈给你。

### 原文金句

> 尊重上级是我们的天职，尊重平级是本分，尊重下级是美德。

> 对客户、对外来的客人要遵守礼仪规范，这是我们基本的素养。`

function roundTrip(md: string): string {
  const editor = new Editor({ extensions: editorExtensions(), content: md, contentType: 'markdown' })
  const out = fixCallouts(editor.getMarkdown())
  editor.destroy()
  return out
}

describe('正文编辑器的 Markdown 往返', () => {
  it('表格内容、对齐和任务勾选状态可往返', () => {
    const md = '| 名称 | 数值 |\n| :--- | ---: |\n| **测试** | 42 |\n\n- [ ] 待办\n- [x] 已完成'
    const out = roundTrip(md)
    expect(out).toContain('**测试**')
    expect(out).toContain('42')
    expect(out).toMatch(/\|\s*:?-+:?\s*\|\s*-+:\s*\|/)
    expect(out).toContain('- [ ] 待办')
    expect(out).toContain('- [x] 已完成')
    const editor = new Editor({ extensions: editorExtensions(), content: md, contentType: 'markdown' })
    expect(editor.getHTML()).toContain('<table')
    expect(editor.getHTML()).toContain('data-type="taskList"')
    editor.destroy()
  })
  it('小标题、列表、加粗、引用原样进出', () => {
    expect(roundTrip(BODY).trim()).toBe(BODY)
  })
  it('图片中的文字折叠框（Obsidian callout）原样进出', () => {
    const md = ['### 配色', '', '- 白底黑字', '', '> [!info]- 图片中的文字', '> 第一行', '> 第二行'].join('\n')
    expect(roundTrip(md).trim()).toBe(md)
  })
})

it('正文编辑保留代码块、行内代码、链接地址和分割线', () => {
  const md = [
    '```js',
    'const answer = 42',
    '```',
    '',
    '使用 `answer`，访问[链接](https://example.invalid)。',
    '',
    '---',
  ].join('\n')
  const out = roundTrip(md)
  expect(out).toContain('```js\nconst answer = 42\n```')
  expect(out).toContain('`answer`')
  expect(out).toContain('[链接](https://example.invalid)')
  expect(out).toContain('---')
})
