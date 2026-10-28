"""从作者选定的 Noto Sans SC 生成软件内置的两个 WOFF2 子集。"""

import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="C:/Windows/Fonts/NotoSansSC-VF.ttf")
    args = parser.parse_args()
    hanzi = (ROOT / "scripts/fonts/通用规范汉字表.txt").read_text(encoding="utf-8-sig")
    hanzi = set("".join(hanzi.split()))
    assert len(hanzi) == 8105, "字表应有 8105 个不同汉字"
    characters = set(hanzi)
    # ASCII、常用西文符号、全角标点、箭头、数学及几何符号。
    for start, end in [(0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F),
                       (0x2100, 0x22FF), (0x2460, 0x25FF), (0x3000, 0x303F),
                       (0xFF00, 0xFFEF)]:
        characters.update(map(chr, range(start, end + 1)))
    output = ROOT / "src/assets/fonts"
    output.mkdir(parents=True, exist_ok=True)
    for name, weights in [("regular", (400, 500)), ("bold", (600, 700))]:
        font = TTFont(args.source, recalcTimestamp=False)
        options = subset.Options()
        options.flavor = "woff2"
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=map(ord, characters))
        subsetter.subset(font)
        assert set(map(ord, hanzi)) <= font.getBestCmap().keys(), "源字体缺少字表中的汉字"
        font = instantiateVariableFont(font, {"wght": weights}, inplace=True)
        font.flavor = "woff2"
        path = output / f"noto-sans-sc-{name}.woff2"
        font.save(path)
        print(f"{path.name}: {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
