from __future__ import annotations

import csv
from pathlib import Path

from ..registry import Lab

_COLUMNS = [
    "scenario_id", "name", "category", "status", "severity",
    "detection_source", "run_id", "timestamp",
    "observed_behavior", "server_response", "obtained_result",
    "evidence", "recommendation",
]


def write_csv(lab: Lab, path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    by_id = {s.id: s for s in lab.scenarios}
    with p.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=_COLUMNS)
        w.writeheader()
        for r in lab.all_results():
            sc = by_id.get(r.scenario_id)
            w.writerow({
                "scenario_id": r.scenario_id,
                "name": sc.name if sc else "",
                "category": sc.category.value if sc else "",
                "status": r.status.value,
                "severity": r.severity.value,
                "detection_source": r.detection_source.value,
                "run_id": r.run_id,
                "timestamp": r.timestamp,
                "observed_behavior": r.observed_behavior,
                "server_response": r.server_response,
                "obtained_result": r.obtained_result,
                "evidence": " | ".join(r.evidence),
                "recommendation": r.recommendation,
            })
    return p
