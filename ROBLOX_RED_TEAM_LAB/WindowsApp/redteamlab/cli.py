"""Headless command-line interface.

This is fully functional without a GUI, which lets the lab run in CI or on a
server. It is also what the automated tests exercise.

Commands:
  list-scenarios [--category movement|remote|economy|permissions]
  stats          [--results FILE]
  import         --results FILE [--out DIR] [--basename NAME]
  demo           [--out DIR]        # uses the bundled sample result log
  version
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from . import __version__, ingest, logging_setup
from .models import Category
from .registry import Lab
from .reporting import write_all

log = logging.getLogger("redteamlab.cli")

PKG_DIR = Path(__file__).resolve().parent
APP_DIR = PKG_DIR.parent                       # .../WindowsApp
PROJECT_DIR = APP_DIR.parent                    # .../ROBLOX_RED_TEAM_LAB
SAMPLE_RESULTS = APP_DIR / "sample_data" / "sample_results.json"
DEFAULT_REPORTS = PROJECT_DIR / "Reports"


def _lab_with_results(results_file: Path | None) -> Lab:
    lab = Lab()
    if results_file is not None:
        records = ingest.load_records(results_file)
        unknown = lab.apply_records(records)
        if unknown:
            log.warning("Ignored %d record(s) for unknown scenario ids: %s",
                        len(unknown), ", ".join(sorted(set(unknown))))
    return lab


def cmd_list_scenarios(args) -> int:
    lab = Lab()
    scenarios = lab.scenarios
    if args.category:
        scenarios = lab.scenarios_in(Category(args.category))
    for s in scenarios:
        print(f"{s.id}  [{s.category.value:<11}] {s.name}  (sev-if-failed: {s.severity_if_failed.value})")
    print(f"\n{len(scenarios)} scenario(s).")
    return 0


def cmd_stats(args) -> int:
    lab = _lab_with_results(Path(args.results) if args.results else None)
    print(json.dumps(lab.stats(), indent=2))
    return 0


def cmd_import(args) -> int:
    lab = _lab_with_results(Path(args.results))
    out = Path(args.out) if args.out else DEFAULT_REPORTS
    paths = write_all(lab, out, basename=args.basename)
    for kind, p in paths.items():
        print(f"{kind.upper():<5} -> {p}")
    print("\nStats:", json.dumps(lab.stats()))
    return 0


def cmd_demo(args) -> int:
    if not SAMPLE_RESULTS.exists():
        log.error("Sample results not found at %s", SAMPLE_RESULTS)
        return 2
    lab = _lab_with_results(SAMPLE_RESULTS)
    out = Path(args.out) if args.out else DEFAULT_REPORTS
    paths = write_all(lab, out, basename="demo_report")
    print("Generated demo reports from bundled sample log:")
    for kind, p in paths.items():
        print(f"  {kind.upper():<5} -> {p}")
    print("\nStats:", json.dumps(lab.stats(), indent=2))
    return 0


def cmd_version(args) -> int:
    print(f"ROBLOX RED TEAM LAB v{__version__}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="redteamlab", description="ROBLOX RED TEAM LAB - control & reporting CLI")
    p.add_argument("--log-dir", default=None, help="write a log file into this directory")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("list-scenarios", help="list built-in scenarios")
    sp.add_argument("--category", choices=[c.value for c in Category])
    sp.set_defaults(func=cmd_list_scenarios)

    sp = sub.add_parser("stats", help="print dashboard stats (optionally from a result log)")
    sp.add_argument("--results")
    sp.set_defaults(func=cmd_stats)

    sp = sub.add_parser("import", help="ingest a result log and write reports")
    sp.add_argument("--results", required=True)
    sp.add_argument("--out")
    sp.add_argument("--basename", default="report")
    sp.set_defaults(func=cmd_import)

    sp = sub.add_parser("demo", help="generate reports from the bundled sample log")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_demo)

    sp = sub.add_parser("version")
    sp.set_defaults(func=cmd_version)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging_setup.configure(args.log_dir)
    try:
        return args.func(args)
    except ingest.IngestError as exc:
        log.error("%s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
