// 对照原文时，给正文里“当前点中的那一段”加 is-linked 样式（F30）。
// 不能直接改编辑器里的元素：编辑器会把不认识的改动当成异常并重画，改动随之丢失；所以用编辑器自己的“装饰”
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const linkedBlockKey = new PluginKey<number | null>('linkedBlock')

export const LinkedBlock = Extension.create({
  name: 'linkedBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: linkedBlockKey,
        state: {
          init: () => null,
          apply(tr, pos) {
            const next = tr.getMeta(linkedBlockKey) as number | null | undefined
            if (next !== undefined) return next
            return pos === null ? null : tr.mapping.map(pos)
          },
        },
        props: {
          decorations(state) {
            const pos = linkedBlockKey.getState(state)
            const node = pos === null || pos === undefined ? null : state.doc.nodeAt(pos)
            if (pos === null || pos === undefined || !node) return null
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'is-linked' })])
          },
        },
      }),
    ]
  },
})
