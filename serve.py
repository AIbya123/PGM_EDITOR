#!/usr/bin/env python3
"""Nav2 地图精修工具 — 可选的本地 / 开发板服务。

零第三方依赖，只用 Python 标准库。启动后：
  * 浏览器访问 http://<地址>:<端口>/ 打开编辑器；
  * 页面可以直接列出、打开并保存 --dir 目录下的 .pgm / .yaml；
  * 保存前会自动在 .mapedit_backup/ 中保留一份带时间戳的备份。

用法示例：
  python3 serve.py --dir ~/maps
  python3 serve.py --dir ~/maps --host 0.0.0.0 --port 8765   # 开发板远程访问
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sys
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
EDITOR = HERE / "map_editor.html"
SEG_SAFE = re.compile(r"^[A-Za-z0-9._\- 一-鿿]{1,120}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9._\- 一-鿿]{1,160}\.(?:pgm|ya?ml)$", re.IGNORECASE)
MAX_BODY = 256 * 1024 * 1024  # 256 MB
BACKUP_KEEP = 20
MAX_DEPTH = 8


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Nav2MapEditor/1.0"

    mapdir: Path = Path(".")
    quiet: bool = False

    # ------------------------------------------------------------- 基础响应

    def log_message(self, fmt, *args):  # noqa: A003
        if not self.quiet:
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_bytes(self, code: int, ctype: str, data: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code: int = 200):
        self._send_bytes(code, "application/json; charset=utf-8",
                         json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _error(self, code: int, message: str):
        self._json({"ok": False, "error": message}, code)

    # ------------------------------------------------------------- 路径安全

    def _resolve(self, name: str) -> Path | None:
        name = (name or "").strip().replace("\\", "/")
        if not name or name.startswith("/"):
            return None
        parts = name.split("/")
        if len(parts) > MAX_DEPTH:
            return None
        fname = parts[-1]
        if fname.startswith(".") or not FILE_NAME.match(fname):
            return None
        for part in parts[:-1]:
            if part in ("", ".", "..") or part.startswith(".") or not SEG_SAFE.match(part):
                return None
        base = self.mapdir.resolve()
        target = (base / Path(*parts)).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            return None
        return target

    def _list_files(self):
        """递归列出地图目录中的 .pgm（跳过隐藏目录），返回相对路径。"""
        base = self.mapdir
        files = []
        try:
            candidates = sorted(base.rglob("*.pgm"))
        except OSError:
            candidates = []
        for p in candidates:
            try:
                rel = p.relative_to(base)
            except ValueError:
                continue
            if len(rel.parts) > MAX_DEPTH:
                continue
            if any(part.startswith(".") for part in rel.parts):
                continue
            if not p.is_file():
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            has_yaml = p.with_suffix(".yaml").exists() or p.with_suffix(".yml").exists()
            files.append({
                "name": rel.as_posix(),
                "size": st.st_size,
                "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)),
                "has_yaml": has_yaml,
            })
        return files

    # ---------------------------------------------------------------- GET

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            if not EDITOR.exists():
                return self._error(500, "未找到 map_editor.html，请先运行 python3 build.py")
            try:
                data = EDITOR.read_bytes()
            except OSError as exc:
                return self._error(500, f"读取编辑器失败：{exc}")
            self._send_bytes(200, "text/html; charset=utf-8", data)
            return

        if path == "/api/info":
            base = self.mapdir.resolve()
            self._json({
                "ok": True,
                "version": 1,
                "dir": str(base),
                "files": self._list_files(),
            })
            return

        if path == "/api/file":
            name = (query.get("name") or [""])[0]
            target = self._resolve(name)
            if target is None:
                return self._error(400, "非法文件名")
            if not target.is_file():
                return self._error(404, "文件不存在")
            suffix = target.suffix.lower()
            if suffix == ".pgm":
                ctype = "image/x-portable-graymap"
            else:
                ctype = "text/yaml; charset=utf-8"
            try:
                data = target.read_bytes()
            except OSError as exc:
                return self._error(500, f"读取失败：{exc}")
            self._send_bytes(200, ctype, data)
            return

        return self._error(404, "not found")

    # --------------------------------------------------------------- POST

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/save":
            return self._error(404, "not found")

        query = parse_qs(parsed.query)
        name = (query.get("name") or [""])[0]
        target = self._resolve(name)
        if target is None:
            return self._error(400, "非法文件名")

        raw_len = self.headers.get("Content-Length")
        try:
            length = int(raw_len)
        except (TypeError, ValueError):
            return self._error(411, "缺少 Content-Length")
        if length < 0 or length > MAX_BODY:
            return self._error(413, "请求体过大")
        body = self.rfile.read(length)

        if target.suffix.lower() == ".pgm":
            if not (body.startswith(b"P5") or body.startswith(b"P2")):
                return self._error(400, "内容不是 PGM 数据")
        else:
            try:
                body.decode("utf-8")
            except UnicodeDecodeError:
                return self._error(400, "YAML 不是 UTF-8 文本")

        backup = None
        if target.exists():
            backup = self._backup(target)

        tmp = target.with_name(target.name + ".tmp")
        try:
            tmp.write_bytes(body)
            os.replace(tmp, target)
        except OSError as exc:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return self._error(500, f"写入失败：{exc}")

        self._json({
            "ok": True,
            "name": target.name,
            "path": str(target),
            "bytes": len(body),
            "backup": backup,
        })

    # ------------------------------------------------------------- 备份

    def _backup(self, target: Path) -> str | None:
        try:
            bdir = self.mapdir / ".mapedit_backup"
            bdir.mkdir(exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            try:
                label = target.relative_to(self.mapdir.resolve()).as_posix().replace("/", "_")
            except ValueError:
                label = target.name
            dest = bdir / f"{label}.{stamp}.bak"
            n = 1
            while dest.exists():
                dest = bdir / f"{label}.{stamp}-{n}.bak"
                n += 1
            shutil.copy2(target, dest)
            backups = sorted(bdir.glob("*.bak"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in backups[BACKUP_KEEP:]:
                try:
                    old.unlink()
                except OSError:
                    pass
            return str(dest)
        except OSError:
            return None


def lan_hint() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def main() -> int:
    ap = argparse.ArgumentParser(description="Nav2 地图精修工具 · 本地服务")
    ap.add_argument("--dir", default=".", help="地图目录（默认当前目录）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址，开发板远程访问用 0.0.0.0")
    ap.add_argument("--port", type=int, default=8765, help="端口（默认 8765）")
    ap.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    ap.add_argument("--quiet", action="store_true", help="不打印每个请求")
    args = ap.parse_args()

    mapdir = Path(args.dir).expanduser().resolve()
    if not mapdir.is_dir():
        print(f"错误：地图目录不存在：{mapdir}", file=sys.stderr)
        return 1
    if not EDITOR.exists():
        print("错误：未找到 map_editor.html。请先运行：python3 build.py", file=sys.stderr)
        return 1

    Handler.mapdir = mapdir
    Handler.quiet = args.quiet

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print(f"错误：无法监听 {args.host}:{args.port} — {exc}", file=sys.stderr)
        return 1
    httpd.daemon_threads = True

    shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{shown_host}:{args.port}/"
    print()
    print("  Nav2 地图精修工具已启动")
    print(f"  本机地址 : {url}")
    if args.host in ("0.0.0.0", "::"):
        ip = lan_hint()
        if ip:
            print(f"  局域网   : http://{ip}:{args.port}/")
    print(f"  地图目录 : {mapdir}")
    print("  停止服务 : Ctrl+C")
    print()

    if args.open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
