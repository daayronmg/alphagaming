from __future__ import annotations

import json
from pathlib import Path

from ..registry import Lab


def build_payload(lab: Lab) -> dict:
    return {
        "meta": lab.meta.__dict__,
        "stats": lab.stats(),
        "scenarios": [s.to_dict() for s in lab.scenarios],
        "results": [r.to_dict() for r in lab.all_results()],
    }


def write_json(lab: Lab, path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(build_payload(lab), indent=2, ensure_ascii=False), encoding="utf-8")
    return p
