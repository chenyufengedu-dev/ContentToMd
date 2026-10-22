// Obsidian 的提示框：> [!info]- 图片中的文字（视觉收藏里 AI 写出的图中文字就是这个格式）。
// 编辑器里它是一个普通引用块，第一行会露出 [!info]- 这串标记；这里用“装饰”把引用块画成提示框：
// 藏起标记、标题加粗、整块换成强调色浅底。文件内容不变，保存时照旧写回 [!info]- 的写法（见 extensions.ts 的 fixCallouts）。
// 不能直接改编辑器里的元素（编辑器会把不认识的改动当成异常重画），所以和 linkedBlock 一样用编辑器自己的“装饰”
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** [!类型] 后面可以跟 - 或 +（Obsidian 的折叠标记），再跟标题 */
const MARK = /^\[!([\w-]+)\][+-]?[ \t]*/

export const Callout = Extension.create({
  name: 'callout',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('callout'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.forEach((node, offset) => {
              if (node.type.name !== 'blockquote') return
              const para = node.firstChild
              if (!para || para.type.name !== 'paragraph') return
              // 段落里的换行（硬换行）按 \n 算，每个字符正好占一个位置
              const text = para.textBetween(0, para.content.size, undefined, '\n')
              const m = MARK.exec(text)
              if (!m) return
              const start = offset + 2 // 引用块开头 + 段落开头
              decos.push(Decoration.node(offset, offset + node.nodeSize, { class: `callout callout-${m[1]}` }))
              decos.push(Decoration.inline(start, start + m[0].length, { class: 'callout-mark' }))
              const newline = text.indexOf('\n')
              const titleEnd = start + (newline < 0 ? text.length : newline)
              if (titleEnd > start + m[0].length)
                decos.push(Decoration.inline(start + m[0].length, titleEnd, { class: 'callout-title' }))
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})
