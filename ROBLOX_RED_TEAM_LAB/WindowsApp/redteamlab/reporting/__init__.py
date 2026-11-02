"""Report generators (JSON / CSV / HTML)."""
from __future__ import annotations

from pathlib import Path

from ..registry import Lab
from .csv_report import write_csv
from .html_report import write_html
from .json_report import write_json

__all__ = ["write_json", "write_csv", "write_html", "write_all"]


def write_all(lab: Lab, out_dir: str | Path, basename: str = "report") -> dict[str, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    return {
        "json": write_json(lab, out / f"{basename}.json"),
        "csv": write_csv(lab, out / f"{basename}.csv"),
        "html": write_html(lab, out / f"{basename}.html"),
    }
