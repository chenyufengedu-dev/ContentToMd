// 设计调节页的候选方案：每组选项替换一组设计令牌（变量名见 src/style.css）。
// 只在开发时用；作者选定后，把选中的值写进 src/style.css 的默认值和 docs/设计规范.md

export type Tokens = Record<string, string>
export interface Option {
  id: string
  label: string
  tokens: Tokens
}
export interface Group {
  id: string
  label: string
  options: Option[]
}

/** 主色只给一个值，悬停色和浅底按它自动推算 */
const accent = (hex: string): Tokens => ({
  '--primary': hex,
  '--primary-hover': `color-mix(in srgb, ${hex} 86%, black)`,
  '--primary-soft': `color-mix(in srgb, ${hex} 9%, white)`,
})

export const GROUPS: Group[] = [
  {
    id: 'accent',
    label: '主色',
    options: [
      { id: 'indigo', label: '靛蓝', tokens: accent('#4b5bd6') },
      { id: 'blue', label: '蓝', tokens: accent('#2f6bf0') },
      { id: 'ink', label: '墨黑', tokens: accent('#1f2937') },
      { id: 'teal', label: '青绿', tokens: accent('#0f8a7e') },
      { id: 'violet', label: '紫', tokens: accent('#7a5af5') },
    ],
  },
  {
    id: 'radius',
    label: '圆角',
    options: [
      {
        id: 's',
        label: '小',
        tokens: {
          '--radius-sm': '4px',
          '--radius-md': '6px',
          '--panel-radius': '10px',
          '--radius-chip': '6px',
          '--radius-num': '8px',
        },
      },
      {
        id: 'm',
        label: '中',
        tokens: {
          '--radius-sm': '6px',
          '--radius-md': '10px',
          '--panel-radius': '14px',
          '--radius-chip': '8px',
          '--radius-num': '50%',
        },
      },
      {
        id: 'l',
        label: '大',
        tokens: {
          '--radius-sm': '8px',
          '--radius-md': '12px',
          '--panel-radius': '20px',
          '--radius-chip': '999px',
          '--radius-num': '50%',
        },
      },
      {
        id: 'xl',
        label: '很大',
        tokens: {
          '--radius-sm': '10px',
          '--radius-md': '16px',
          '--panel-radius': '28px',
          '--radius-chip': '999px',
          '--radius-num': '50%',
        },
      },
    ],
  },
  {
    id: 'surface',
    label: '层次',
    options: [
      {
        id: 'flat',
        label: '纯白平铺',
        tokens: {
          '--bg': '#ffffff',
          '--panel-border': '#e7e9ee',
          '--shadow-card': 'none',
          '--panel-gap': '0px',
          '--window-pad': '0px',
          '--panel-radius': '0px',
        },
      },
      {
        id: 'layered',
        label: '浅灰底白卡片',
        tokens: {
          '--bg': '#f4f5f7',
          '--panel-border': 'transparent',
          '--shadow-card': '0 1px 2px rgb(16 24 40 / 4%), 0 4px 16px rgb(16 24 40 / 4%)',
          '--panel-gap': '16px',
          '--window-pad': '16px',
        },
      },
      {
        id: 'outlined',
        label: '描边卡片',
        tokens: {
          '--bg': '#f7f8fa',
          '--panel-border': '#e4e7ec',
          '--shadow-card': 'none',
          '--panel-gap': '16px',
          '--window-pad': '16px',
        },
      },
      {
        id: 'raised',
        label: '浮起',
        tokens: {
          '--bg': '#eceef3',
          '--panel-border': 'transparent',
          '--shadow-card': '0 2px 6px rgb(16 24 40 / 6%), 0 16px 40px rgb(16 24 40 / 8%)',
          '--panel-gap': '20px',
          '--window-pad': '20px',
        },
      },
    ],
  },
  {
    id: 'weight',
    label: '字重',
    options: [
      { id: 'bold', label: '粗', tokens: { '--fw-title': '700', '--fw-heading': '600', '--fw-label': '600' } },
      { id: 'medium', label: '适中', tokens: { '--fw-title': '600', '--fw-heading': '600', '--fw-label': '500' } },
      { id: 'light', label: '轻', tokens: { '--fw-title': '500', '--fw-heading': '500', '--fw-label': '500' } },
    ],
  },
  {
    id: 'size',
    label: '字号',
    options: [
      {
        id: 's',
        label: '小',
        tokens: {
          '--fs-xs': '11px',
          '--fs-sm': '12px',
          '--fs-md': '13px',
          '--fs-lg': '15px',
          '--fs-xl': '18px',
          '--fs-2xl': '26px',
        },
      },
      {
        id: 'm',
        label: '中',
        tokens: {
          '--fs-xs': '12px',
          '--fs-sm': '13px',
          '--fs-md': '14px',
          '--fs-lg': '16px',
          '--fs-xl': '20px',
          '--fs-2xl': '30px',
        },
      },
      {
        id: 'l',
        label: '大',
        tokens: {
          '--fs-xs': '13px',
          '--fs-sm': '14px',
          '--fs-md': '15px',
          '--fs-lg': '17px',
          '--fs-xl': '22px',
          '--fs-2xl': '34px',
        },
      },
    ],
  },
  {
    id: 'density',
    label: '疏密',
    options: [
      {
        id: 'compact',
        label: '紧凑',
        tokens: {
          '--sp-3': '8px',
          '--sp-4': '12px',
          '--sp-5': '20px',
          '--sp-6': '24px',
          '--sp-7': '36px',
          '--h-sm': '28px',
          '--h-md': '36px',
        },
      },
      {
        id: 'normal',
        label: '适中',
        tokens: {
          '--sp-3': '12px',
          '--sp-4': '16px',
          '--sp-5': '24px',
          '--sp-6': '32px',
          '--sp-7': '48px',
          '--h-sm': '32px',
          '--h-md': '40px',
        },
      },
      {
        id: 'roomy',
        label: '宽松',
        tokens: {
          '--sp-3': '12px',
          '--sp-4': '20px',
          '--sp-5': '28px',
          '--sp-6': '40px',
          '--sp-7': '56px',
          '--h-sm': '36px',
          '--h-md': '44px',
        },
      },
    ],
  },
]

/** 和 src/style.css 默认值一致的那一组 */
export const DEFAULT_CHOICE: Record<string, string> = {
  accent: 'indigo',
  radius: 'l',
  surface: 'layered',
  weight: 'bold',
  size: 'm',
  density: 'normal',
}
