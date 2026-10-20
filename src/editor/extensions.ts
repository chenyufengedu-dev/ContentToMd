// 确认页正文编辑器的扩展：所见即所得编辑，进出都是 Markdown（与笔记文件格式一致）
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { LinkedBlock } from './linkedBlock'

export const editorExtensions = () => [
  // 笔记正文用不到的格式不开，避免写出笔记里本来没有的东西
  StarterKit.configure({ link: false, underline: false, code: false, codeBlock: false, horizontalRule: false }),
  Markdown,
  LinkedBlock,
]
