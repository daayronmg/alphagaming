"""Logging configuration shared by CLI and GUI."""
from __future__ import annotations

import logging
from pathlib import Path


def configure(log_dir: str | Path | None = None, level: int = logging.INFO) -> Path | None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    log_file: Path | None = None
    if log_dir is not None:
        d = Path(log_dir)
        d.mkdir(parents=True, exist_ok=True)
        log_file = d / "redteamlab.log"
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )
    return log_file
