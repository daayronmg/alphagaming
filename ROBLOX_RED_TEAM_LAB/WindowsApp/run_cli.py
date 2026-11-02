#!/usr/bin/env python3
"""Headless entry point. Works on any OS with just the standard library.

Usage:
    python run_cli.py demo
    python run_cli.py list-scenarios
    python run_cli.py import --results path/to/results.json --out ../Reports
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from redteamlab.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
