#!/usr/bin/env python3
"""Host bridge so Maestro runScript can write HC_E2E commands without Java.type."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "e2e-android-cmd.sh")
ANDROID_HOME = os.environ.get("ANDROID_HOME") or os.path.join(os.environ.get("HOME", ""), "Library/Android/sdk")
ADB = os.path.join(ANDROID_HOME, "platform-tools", "adb")
ENV = os.environ.copy()
ENV["PATH"] = os.path.join(ANDROID_HOME, "platform-tools") + ":" + ENV.get("PATH", "")
ENV["ANDROID_HOME"] = ANDROID_HOME
PORT = int(os.environ.get("HC_E2E_BRIDGE_PORT", "18765"))
DONE_TIMEOUT_SEC = int(os.environ.get("HC_E2E_DONE_TIMEOUT", "180"))


def serial() -> str:
    out = subprocess.check_output([ADB, "get-serialno"], env=ENV, text=True).strip()
    if not out or out == "unknown":
        raise RuntimeError("no adb serial")
    return out


def read_sidecar(app: str) -> str:
    try:
        return subprocess.check_output(
            [ADB, "shell", "run-as", app, "cat", "files/hc_e2e_cmd.txt"],
            env=ENV,
            text=True,
            stderr=subprocess.DEVNULL,
        ).replace("\r", "")
    except subprocess.CalledProcessError:
        return ""


def wait_done(app: str, command_url: str) -> str:
    deadline = time.time() + DONE_TIMEOUT_SEC
    while time.time() < deadline:
        text = read_sidecar(app)
        if text.startswith("HC_E2E_DONE") and "channel-up" not in text.split("\n", 1)[0]:
            return text
        if text.startswith("HC_E2E:") and command_url not in text:
            # Overwritten by a later command; keep waiting for DONE.
            pass
        time.sleep(0.5)
    raise TimeoutError("app did not ACK HC_E2E_DONE")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in ("/e2e", "/health"):
            self.send_error(404)
            return
        if parsed.path == "/health":
            self._write(200, "ok")
            return
        query = parse_qs(parsed.query)
        url = unquote((query.get("url") or [""])[0]).strip()
        app = unquote((query.get("app") or ["com.hypercolor"])[0]).strip() or "com.hypercolor"
        if not url.lower().startswith("hypercolor://e2e/"):
            self._write(400, "url must be hypercolor://e2e/...")
            return
        try:
            out = subprocess.check_output(
                [SCRIPT, serial(), app, url],
                env=ENV,
                text=True,
                stderr=subprocess.STDOUT,
            )
            done = wait_done(app, url)
        except subprocess.CalledProcessError as err:
            self._write(500, err.output or str(err))
            return
        except TimeoutError as err:
            self._write(504, str(err))
            return
        if "HC_E2E_DONE:error" in done.split("\n", 1)[0]:
            self._write(500, done)
            return
        self._write(200, out + done)

    def _write(self, code: int, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"hc-e2e-bridge listening on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
