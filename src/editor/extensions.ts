// 确认页正文编辑器的扩展：所见即所得编辑，进出都是 Markdown（与笔记文件格式一致）
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { LinkedBlock } from './linkedBlock'
import { Callout } from './callout'

export const editorExtensions = () => [
  // 保留已有 Markdown 的代码和链接；链接在编辑区只编辑，不直接打开。
  StarterKit.configure({ underline: false, link: { openOnClick: false } }),
  Markdown,
  TableKit.configure({ table: { renderWrapper: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  LinkedBlock,
  Callout,
]

/**
 * 编辑器导出的 Markdown 会把方括号转义成 \[，Obsidian 的提示框（> [!info]- 图片中的文字）就认不出了。
 * 只还原引用开头的提示框标记，正文里别处的转义不动
 */
export const fixCallouts = (md: string) => md.replace(/^((?:> ?)+)\\\[!([\w-]+)\\\]/gm, '$1[!$2]')
