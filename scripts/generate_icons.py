"""从同一矢量源生成 Windows 桌面图标和透明窗口图标。仅使用标准库及项目自带 Tauri CLI。"""

from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256, 512)


def export_png(source: Path, destination: Path) -> None:
    command = [str(ROOT / "node_modules" / ".bin" / "tauri.cmd"), "icon", str(source), "--output", str(destination)]
    for size in SIZES:
        command.extend(("--png", str(size)))
    subprocess.run(command, cwd=ROOT, check=True)


def pack_ico(source: Path, destination: Path) -> None:
    # Windows Vista 及以后支持 ICO 中的 PNG 帧；目录项保留各档精确像素大小。
    frames = [(size, (source / f"{size}x{size}.png").read_bytes()) for size in SIZES if size <= 256]
    offset = 6 + 16 * len(frames)
    entries = bytearray(struct.pack("<HHH", 0, 1, len(frames)))
    for size, data in frames:
        edge = 0 if size == 256 else size
        entries.extend(struct.pack("<BBBBHHII", edge, edge, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    destination.write_bytes(entries + b"".join(data for _, data in frames))


def main() -> None:
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    with tempfile.TemporaryDirectory(prefix=".icon-export-", dir=ROOT) as temporary:
        work = Path(temporary).resolve()
        assert work.parent == ROOT  # 临时目录清理只发生在本项目下。
        tree = ET.parse(ROOT / "assets" / "app-icon.svg")
        root = tree.getroot()
        background = root.find("{http://www.w3.org/2000/svg}rect")
        assert background is not None
        root.remove(background)
        # 小尺寸白色线条需要光学加厚；原始路径、内部比例及桌面版不变。
        for element in root.iter():
            if element.get("stroke-width") is not None:
                element.set("stroke-width", str(float(element.get("stroke-width")) * 1.5))
            for attribute in ("fill", "stroke"):
                if element.get(attribute) not in (None, "none"):
                    element.set(attribute, "#FFFFFF")
        transparent = work / "window.svg"
        tree.write(transparent, encoding="utf-8", xml_declaration=True)
        desktop = work / "desktop"
        window = work / "window"
        export_png(ROOT / "assets" / "app-icon.svg", desktop)
        export_png(transparent, window)
        for source, target in (
            (desktop / "512x512.png", ICONS / "icon.png"),
            (desktop / "32x32.png", ICONS / "32x32.png"),
            (desktop / "128x128.png", ICONS / "128x128.png"),
            (desktop / "256x256.png", ICONS / "128x128@2x.png"),
            (window / "128x128.png", ICONS / "window.png"),
        ):
            shutil.copyfile(source, target)
        pack_ico(desktop, ICONS / "icon.ico")
        pack_ico(window, ICONS / "window.ico")


if __name__ == "__main__":
    main()
