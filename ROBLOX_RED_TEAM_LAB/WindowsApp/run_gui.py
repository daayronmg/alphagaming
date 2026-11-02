#!/usr/bin/env python3
"""GUI entry point (PySide6).

Requires PySide6 (see requirements.txt). On a headless machine without Qt this
will exit with a clear message instead of a traceback. The CLI (run_cli.py)
provides the same functionality without a display.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def main() -> int:
    try:
        from redteamlab.gui.app import run
    except ImportError as exc:
        print("PySide6 is not installed or no display is available.", file=sys.stderr)
        print(f"Reason: {exc}", file=sys.stderr)
        print("Install with:  pip install -r requirements.txt", file=sys.stderr)
        print("Or use the headless CLI:  python run_cli.py demo", file=sys.stderr)
        return 1
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
