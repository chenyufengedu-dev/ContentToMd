# 内置字体生成

源文件：作者电脑 `C:/Windows/Fonts/NotoSansSC-VF.ttf`，Noto Sans SC 可变字体。
字体许可见 `src/assets/fonts/OFL.txt`。原字体不放进仓库。

安装生成依赖：`python -m pip install "fonttools[woff]"`。
在项目根目录运行：`python -X utf8 scripts/generate_fonts.py [源字体路径]`。
脚本使用 fonttools 的 subset API（与 pyftsubset 相同的子集引擎），再裁剪可变字重范围。

产物：`src/assets/fonts/noto-sans-sc-regular.woff2`（400–500）、
`src/assets/fonts/noto-sans-sc-bold.woff2`（600–700）。保留实际使用的四档字重。
两文件合计 3,913,244 字节。相同字表分成400、500、600、700四个静态档，
合计4,994,716字节，因此采用两个可变子集。

字表收录 8105 个不同汉字，来自
[通用规范汉字表数据](https://github.com/jaywcjlove/table-of-general-standard-chinese-characters/blob/main/data/characters.txt)，
字表仓库许可保存在 `字表-LICENSE.txt`；脚本另加 ASCII、全角标点及常用符号。
源字体没有的符号、子集外生僻字由系统字体兜底。

CSS 升降部采用本机 HarmonyOS Sans SC Regular 的 hhea 度量：
unitsPerEm 1000、ascent 928、descent -244、lineGap 0。
最终以真实页面截图的字形上下留白核对，量测证据记入 docs/进度.md。
