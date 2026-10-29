// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions, fixCallouts } from './extensions'

const BODY = `### 一、记录问题

- 摘录原句要页码，记录观点要问题，补充例子要过程。
- 每次阅读前先写下**阅读问题**，这样摘录才有明确的用途。

### 二、摘录线索

1. 摘录无出处，回顾时就很难找到原来的段落。
2. 用熟悉的例子检验观点，再把实践结果补充到笔记里。

### 原文金句

> 摘录原句要记出处页码，记录观点要问题，补充例子要过程。

> 对书中的观点要写下自己的理解，这是方便日后回顾的基本步骤。`

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
