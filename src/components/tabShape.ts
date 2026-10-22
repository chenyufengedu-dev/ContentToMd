// 卡片左上角凸起的梯形标签（设置卡片展开时、收藏库方块卡片的前层）：一条完整的 SVG 路径，见《动画经验》第五节。
// 左边和右上是圆角，右边一条斜边，斜边底部向外翻、平滑接进卡片顶边；下端多伸进卡片一个圆角的高度，盖住卡片的左上圆角

export interface TabShape {
  /** 斜边开始的位置（标签平顶的宽度） */
  width: number
  /** 标签高度（卡片顶边以上露出来的部分） */
  height: number
  /** 圆角，和卡片圆角一致 */
  radius: number
  /** 斜边的水平宽度 */
  slant: number
  /** 斜边底部向外翻的弧线 */
  foot: number
}

export function tabPath(s: TabShape): { d: string; width: number; height: number } {
  const { width: W, height: H, radius: R, slant: SLANT, foot: FOOT } = s
  const len = Math.hypot(SLANT, H)
  const ux = SLANT / len // 斜边方向
  const uy = H / len
  const n = (v: number) => v.toFixed(2)
  const d = [
    `M 0 ${H + R}`, // 左边一直伸到卡片顶边以下一个圆角的高度，盖住卡片的左上圆角
    `L 0 ${R}`,
    `A ${R} ${R} 0 0 1 ${R} 0`, // 左上角用正圆弧（二次曲线画出来的角看着比右边小）
    `L ${W - R} 0`,
    `Q ${W} 0 ${n(W + ux * R)} ${n(uy * R)}`, // 右上角圆过去，接上斜边
    `L ${n(W + SLANT - ux * FOOT)} ${n(H - uy * FOOT)}`,
    `Q ${W + SLANT} ${H} ${W + SLANT + FOOT} ${H}`, // 斜边底部向外翻，平滑接进卡片顶边
    `L ${W + SLANT + FOOT} ${H + R}`, // 卡片顶边以下这一截和卡片同色，看不出来
    'Z',
  ].join(' ')
  return { d, width: W + SLANT + FOOT, height: H + R }
}
