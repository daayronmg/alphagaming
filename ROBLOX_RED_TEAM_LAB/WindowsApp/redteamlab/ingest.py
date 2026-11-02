"""Ingest result logs produced by the Luau self-test harness.

Expected input: a JSON file that is either a list of records, or an object with
a top-level "results" list. Each record is a dict; unknown scenario ids are
reported but not fatal. This module never trusts the file blindly — malformed
records are surfaced, not silently dropped.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class IngestError(Exception):
    pass


def load_records(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    if not p.exists():
        raise IngestError(f"Result file not found: {p}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise IngestError(f"Invalid JSON in {p}: {exc}") from exc
    return normalize(data)


def normalize(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict):
        records = data.get("results", [])
    elif isinstance(data, list):
        records = data
    else:
        raise IngestError("Top-level JSON must be a list or an object with a 'results' list.")

    if not isinstance(records, list):
        raise IngestError("'results' must be a list.")

    clean: list[dict[str, Any]] = []
    for i, rec in enumerate(records):
        if not isinstance(rec, dict):
            log.warning("Skipping non-object record at index %d", i)
            continue
        if "scenario_id" not in rec:
            log.warning("Skipping record at index %d: missing 'scenario_id'", i)
            continue
        clean.append(rec)
    return clean
