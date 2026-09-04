#!/usr/bin/env python3
"""Run one Maestro flow with a hard process timeout so a hung dump cannot stall a catalog."""
from __future__ import annotations

import subprocess
import sys

DEFAULT_SEC = 60


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: maestro-bounded.py <seconds> --device <id> test <flow.yaml>", file=sys.stderr)
        return 2
    try:
        limit = int(sys.argv[1])
    except ValueError:
        print("maestro-bounded.py: first arg must be timeout seconds", file=sys.stderr)
        return 2
    cmd = ["maestro", *sys.argv[2:]]
    try:
        completed = subprocess.run(cmd, timeout=limit, start_new_session=True)
        return int(completed.returncode)
    except subprocess.TimeoutExpired as exc:
        print(f"maestro_timeout {limit}s cmd={' '.join(cmd)}", file=sys.stderr)
        proc = exc.process
        if proc is not None and proc.pid:
            import os
            import signal

            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                proc.kill()
        return 124
    except FileNotFoundError:
        print("maestro binary not found on PATH", file=sys.stderr)
        return 127


if __name__ == "__main__":
    raise SystemExit(main())
