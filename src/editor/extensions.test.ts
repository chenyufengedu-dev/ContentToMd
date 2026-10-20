// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'

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
  const out = editor.getMarkdown()
  editor.destroy()
  return out
}

describe('正文编辑器的 Markdown 往返', () => {
  it('小标题、列表、加粗、引用原样进出', () => {
    expect(roundTrip(BODY).trim()).toBe(BODY)
  })
})
