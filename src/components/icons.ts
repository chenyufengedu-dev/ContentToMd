import { defineComponent, h } from 'vue'
import type { Component } from 'vue'
import './icons.css'

/**
 * 项目里所有图标的唯一入口：18 格线条图标，线宽 1.5；陪衬的线条用浅色（深浅线），
 * 少数图标悬停时有动画（样式在 icons.css）。没重画的几个仍用 lucide，也从这里导出。
 * 下面的 SVG 片段都是源码里写死的常量，不含用户内容。
 */
/** 深浅线只在这个尺寸以上显示；小图标里浅色线条显得发虚，统一当单色画 */
const DUO_MIN_SIZE = 20

function icon(name: string, inner: string): Component {
  return defineComponent({
    name,
    props: { size: { type: [Number, String], default: 16 } },
    setup(props) {
      return () =>
        h('svg', {
          class: Number(props.size) >= DUO_MIN_SIZE ? 'ai' : 'ai ai-mono',
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 18 18',
          width: props.size,
          height: props.size,
          'aria-hidden': 'true',
          innerHTML: inner,
        })
    },
  })
}

export { ImageOff, ExternalLink, List, Coins, Quote } from 'lucide-vue-next'

export const Trash2 = icon(
  'Trash2',
  '\n        <path class="soft a trash-body part" d="M4.5 6.75l.45 7.1a1.5 1.5 0 0 0 1.5 1.4h5.1a1.5 1.5 0 0 0 1.5-1.4l.45-7.1"/>\n        <path class="a trash-body part" d="M7.5 9.25v3.5M10.5 9.25v3.5"/>\n        <g class="a trash-lid"><path d="M2.75 4.75h12.5"/><path d="M7 4.75V3.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.5"/></g>',
)
export const Search = icon(
  'Search',
  '<g class="a search-all part"><circle class="soft" cx="8" cy="8" r="5"/><path class="search-glint" d="M5.6 7.4a2.6 2.6 0 0 1 1.8-1.8"/><path d="M11.75 11.75l3.5 3.5"/></g>',
)
export const CircleAlert = icon(
  'CircleAlert',
  '<g class="a warn-all"><path class="soft" d="M7.7 3.5a1.5 1.5 0 0 1 2.6 0l5.5 9.5a1.5 1.5 0 0 1-1.3 2.25H3.5A1.5 1.5 0 0 1 2.2 13z"/><path d="M9 7v3.25M9 12.6h.01"/></g>',
)
export const ChevronDown = icon('ChevronDown', '<path d="M4.5 7l4.5 4.5L13.5 7"/>')
export const FilePlus2 = icon(
  'FilePlus2',
  '<g transform="scale(.75)" style="stroke-width:1.6"><path class="soft" d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 9h3M8 13h4"/><path class="a part plus-s" d="M14 19h6M17 16v6"/></g>',
)
export const User = icon(
  'User',
  '<circle class="soft" cx="9" cy="6" r="2.75"/><path class="soft" d="M3.75 15.25a5.25 5.25 0 0 1 10.5 0"/>',
)
export const X = icon('X', '<g class="a part x-all"><path d="M4.75 4.75l8.5 8.5M13.25 4.75l-8.5 8.5"/></g>')
export const ChevronRight = icon('ChevronRight', '<path d="M7 4.5L11.5 9 7 13.5"/>')
export const ArrowUpRight = icon('ArrowUpRight', '<g class="a shoot"><path d="M5 13L13 5M6.5 5H13v6.5"/></g>')
export const Minus = icon('Minus', '<path d="M4.5 9h9"/>')
export const Square = icon('Square', '<rect x="4" y="4" width="10" height="10" rx="2.5"/>')
export const Check = icon('Check', '<path class="check-mark" pathLength="1" d="M4.25 9.5l3.25 3.25 6.25-7.5"/>')
export const Circle = icon('Circle', '<circle cx="9" cy="9" r="7"/>')
export const Undo2 = icon(
  'Undo2',
  '<g class="a undo-head"><path d="M6.5 4.5L3.5 7.5l3 3"/></g><path class="a undo-shaft" d="M3.5 7.5h7"/><path d="M10.5 7.5a3.75 3.75 0 0 1 0 7.5H8"/>',
)
export const Redo2 = icon(
  'Redo2',
  '<g class="a redo-head"><path d="M11.5 4.5l3 3-3 3"/></g><path class="a redo-shaft" d="M14.5 7.5h-7"/><path d="M7.5 7.5a3.75 3.75 0 0 0 0 7.5H10"/>',
)
export const Bold = icon(
  'Bold',
  '<path class="soft" d="M5.75 3.5h4a2.5 2.5 0 0 1 0 5h-4z"/><path class="soft" d="M5.75 8.5h4.75a2.5 2.5 0 0 1 0 5H5.75z"/>',
)
export const ListOrdered = icon(
  'ListOrdered',
  '<g transform="scale(.75)" style="stroke-width:2"><path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/></g>',
)
export const CircleCheck = icon(
  'CircleCheck',
  '<circle class="soft l2 a check-ring part" cx="9" cy="9" r="7"/><path class="check-mark" pathLength="1" d="M5.75 9.25l2.25 2.25 4.25-4.5"/>',
)
export const Plus = icon(
  'Plus',
  '<rect class="soft l2 a plus-box part" x="2.75" y="2.75" width="12.5" height="12.5" rx="4"/><path class="a plus-mark part" d="M9 5.75v6.5M5.75 9h6.5"/>',
)
export const ChevronLeft = icon(
  'ChevronLeft',
  '<circle class="soft l2" cx="9" cy="9" r="7"/><path class="a back-chev" d="M10.25 5.75L7 9l3.25 3.25"/>',
)
export const Info = icon(
  'Info',
  '<circle class="soft l2" cx="9" cy="9" r="7"/><path class="a info-stem" d="M9 8.25v3.5"/><path class="a info-dot" d="M9 5.7h.01"/>',
)
export const Folder = icon(
  'Folder',
  '<defs><clipPath id="ai-folder-clip"><rect width="18" height="8.25"/></clipPath></defs><path class="soft l2" d="M2.75 5.25a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z"/><g clip-path="url(#ai-folder-clip)"><rect class="a folder-paper" x="5.25" y="8.75" width="7.5" height="4" rx="1"/></g><path class="soft" d="M2.75 8.25h12.5v4.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z"/>',
)
export const FileText = icon(
  'FileText',
  '<g transform="translate(1.32 1.32) scale(.64)" style="stroke-width:2.34"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path class="l2" d="M14 2v5a1 1 0 0 0 1 1h5"/><path class="a txt-line" d="M10 9H8"/><path class="l2 a txt-line txt-line2" d="M16 13H8"/><path class="l2 a txt-line txt-line3" d="M16 17H8"/></g>',
)
export const PenLine = icon(
  'PenLine',
  '<path class="l2" d="M3.5 5h5M3.5 9h8M3.5 13h11"/><path class="soft a part plus-s" d="M13.25 2.75l.9 2.35 2.35.9-2.35.9-.9 2.35-.9-2.35-2.35-.9 2.35-.9z"/>',
)
export const ImageIcon = icon(
  'ImageIcon',
  '<rect class="soft l2" x="2.5" y="3" width="13" height="12" rx="3"/><circle class="a part img-sun" cx="6.5" cy="7" r="1.25"/><path class="a img-hills" d="M2.75 12.25l3.4-3.1a1.5 1.5 0 0 1 2 0l2.1 1.9 1.2-1a1.5 1.5 0 0 1 1.9 0l2.15 1.85"/>',
)
export const Link2 = icon(
  'Link2',
  '<path class="l2" d="M7.75 10.25a3 3 0 0 0 4.25 0l2.5-2.5a3 3 0 0 0-4.25-4.25l-.75.75"/><path d="M10.25 7.75a3 3 0 0 0-4.25 0l-2.5 2.5a3 3 0 0 0 4.25 4.25l.75-.75"/>',
)
export const Clock = icon(
  'Clock',
  '<circle class="soft l2" cx="9" cy="9" r="7"/><g class="a clock-hands"><path d="M9 5.5V9l2.25 1.5"/></g>',
)
export const Video = icon(
  'Video',
  '<rect class="soft l2" x="2.5" y="4.5" width="9" height="9" rx="2.5"/><path d="M11.5 7.75l3.25-2a.5.5 0 0 1 .75.43v5.64a.5.5 0 0 1-.75.43l-3.25-2"/>',
)
export const AudioLines = icon(
  'AudioLines',
  '<path class="a part bar1" d="M4.5 7.5v3"/><path class="l2 a part bar2" d="M7.25 4.75v8.5"/><path class="a part bar3" d="M10 6.5v5"/><path class="l2 a part bar4" d="M12.75 8v2"/><path class="a part bar5" d="M15.25 7v4"/>',
)
export const Mic = icon(
  'Mic',
  '<rect class="soft a part mic-cap" x="6.5" y="2.5" width="5" height="8" rx="2.5"/><path class="l2" d="M4 8.5a5 5 0 0 0 10 0M9 13.5v2"/>',
)
export const CalendarDays = icon(
  'CalendarDays',
  '<rect class="soft l2" x="2.75" y="3.75" width="12.5" height="11.5" rx="2.5"/><path d="M2.75 7.75h12.5M6.25 2.5v2.5M11.75 2.5v2.5"/>',
)
export const Pencil = icon(
  'Pencil',
  '<path class="l2" d="M8.5 3.5H6A2.5 2.5 0 0 0 3.5 6v6A2.5 2.5 0 0 0 6 14.5h6a2.5 2.5 0 0 0 2.5-2.5V9.5"/><path class="soft" d="M13.2 2.9a1.5 1.5 0 0 1 2.1 2.1L10 10.3l-2.5.6.6-2.5z"/>',
)
export const Hash = icon(
  'Hash',
  '<path d="M6.75 3.5L5.75 14.5M12.5 3.5l-1 11"/><path class="l2" d="M3.5 6.75h11.5M3 11.25h11.5"/>',
)
export const LayoutGrid = icon(
  'LayoutGrid',
  '<rect class="soft" x="2.75" y="2.75" width="5.5" height="5.5" rx="1.75"/><rect class="soft l2" x="9.75" y="2.75" width="5.5" height="5.5" rx="1.75"/><rect class="soft l2" x="2.75" y="9.75" width="5.5" height="5.5" rx="1.75"/><rect class="soft l2" x="9.75" y="9.75" width="5.5" height="5.5" rx="1.75"/>',
)
export const Inbox = icon(
  'Inbox',
  '<path class="soft l2" d="M2.75 10.5l1.9-5.6a1.5 1.5 0 0 1 1.4-1h5.9a1.5 1.5 0 0 1 1.4 1l1.9 5.6v3a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M2.75 10.5H6.5l.75 1.75h3.5l.75-1.75h3.75"/>',
)
export const ListBullet = icon(
  'ListBullet',
  '<path d="M3.5 5h.01M3.5 9h.01M3.5 13h.01"/><path class="l2" d="M7.5 5h7.5M7.5 9h7.5M7.5 13h7.5"/>',
)

export { ImageIcon as Image }
