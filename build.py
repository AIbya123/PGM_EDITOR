#!/usr/bin/env python3
"""把 src/ 下的 HTML/CSS/JS 打包成单文件 map_editor.html。"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"


def main() -> int:
    index = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    core = (SRC / "core.js").read_text(encoding="utf-8")
    app = (SRC / "app.js").read_text(encoding="utf-8")
    js = core + "\n\n" + app

    if "</script" in js.lower():
        print("错误：JS 中包含 </script 字面量，无法安全内联。", file=sys.stderr)
        return 1
    if "<!-- INLINE_CSS -->" not in index or "<!-- INLINE_JS -->" not in index:
        print("错误：src/index.html 缺少内联占位符。", file=sys.stderr)
        return 1

    out = index.replace("<!-- INLINE_CSS -->", css).replace("<!-- INLINE_JS -->", js)
    target = ROOT / "map_editor.html"
    target.write_text(out, encoding="utf-8")

    kb = target.stat().st_size / 1024
    print(f"已生成 {target}  ({kb:.1f} KB, 单文件、无外部依赖)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
