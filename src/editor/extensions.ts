// 确认页正文编辑器的扩展：所见即所得编辑，进出都是 Markdown（与笔记文件格式一致）
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { LinkedBlock } from './linkedBlock'
import { Callout } from './callout'

export const editorExtensions = () => [
  // 笔记正文用不到的格式不开，避免写出笔记里本来没有的东西
  StarterKit.configure({ link: false, underline: false, code: false, codeBlock: false, horizontalRule: false }),
  Markdown,
  LinkedBlock,
  Callout,
]

/**
 * 编辑器导出的 Markdown 会把方括号转义成 \[，Obsidian 的提示框（> [!info]- 图片中的文字）就认不出了。
 * 只还原引用开头的提示框标记，正文里别处的转义不动
 */
export const fixCallouts = (md: string) => md.replace(/^((?:> ?)+)\\\[!([\w-]+)\\\]/gm, '$1[!$2]')
