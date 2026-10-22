// 文件类型图标预览（只在开发时用：/dev/icons.html）：七种图标，大的一排、投放页底下的小的一排
import { createApp, h } from 'vue'
import '../src/style.css'
import FileTypeIcon from '../src/components/FileTypeIcon.vue'
import type { FileKind } from '../src/components/fileKind'

const KINDS: { kind: FileKind; label: string; note: string }[] = [
  { kind: 'md', label: 'Markdown', note: '以前项目的' },
  { kind: 'pdf', label: 'PDF', note: '以前项目的' },
  { kind: 'image', label: '图片', note: '以前项目的' },
  { kind: 'txt', label: 'txt 文本', note: '新画的' },
  { kind: 'docx', label: 'Word', note: '新画的' },
  { kind: 'audio', label: '音频', note: '新画的' },
  { kind: 'video', label: '视频', note: '新画的' },
]

const pill =
  'display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:12px;background:#fff;color:var(--muted);font-size:14px'

createApp({
  render: () =>
    h('div', { style: 'padding:40px;background:var(--bg);min-height:100vh' }, [
      h(
        'div',
        { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-bottom:32px' },
        KINDS.map((k) =>
          h('div', { style: 'width:120px;padding:20px 0;border-radius:16px;background:#fff;text-align:center' }, [
            h(FileTypeIcon, { kind: k.kind, size: 48 }),
            h('div', { style: 'margin-top:10px;font-size:14px;color:var(--fg)' }, k.label),
            h('div', { style: 'font-size:12px;color:var(--faint)' }, k.note),
          ]),
        ),
      ),
      h(
        'div',
        { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        KINDS.map((k) => h('span', { style: pill }, [h(FileTypeIcon, { kind: k.kind, size: 20 }), k.label])),
      ),
    ]),
}).mount('#app')
