"""The Lab: binds scenarios + results together and computes dashboard stats."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from . import evaluator
from .models import Category, LabMeta, Scenario, TestResult, TestStatus
from .scenarios import builtin_scenarios


@dataclass
class Lab:
    scenarios: list[Scenario] = field(default_factory=builtin_scenarios)
    results: dict[str, TestResult] = field(default_factory=dict)  # scenario_id -> latest result
    meta: LabMeta = field(default_factory=LabMeta)

    # ---- scenario access ----
    def scenario(self, scenario_id: str) -> Optional[Scenario]:
        for s in self.scenarios:
            if s.id == scenario_id:
                return s
        return None

    def scenarios_in(self, category: Category) -> list[Scenario]:
        return [s for s in self.scenarios if s.category is category]

    # ---- result loading ----
    def apply_records(self, records: list[dict[str, Any]]) -> list[str]:
        """Evaluate raw records into results. Returns list of unknown scenario ids."""
        unknown: list[str] = []
        for rec in records:
            sid = str(rec.get("scenario_id"))
            sc = self.scenario(sid)
            if sc is None:
                unknown.append(sid)
                continue
            self.results[sid] = evaluator.evaluate_record(sc, rec)
        return unknown

    def result_for(self, scenario_id: str) -> TestResult:
        if scenario_id in self.results:
            return self.results[scenario_id]
        sc = self.scenario(scenario_id)
        return evaluator.pending_result(sc) if sc else TestResult(scenario_id=scenario_id)

    def all_results(self) -> list[TestResult]:
        """One result per scenario (pending if none ingested), scenario order preserved."""
        return [self.result_for(s.id) for s in self.scenarios]

    # ---- dashboard stats ----
    def stats(self) -> dict[str, Any]:
        results = self.all_results()
        counts = {st.value: 0 for st in TestStatus}
        for r in results:
            counts[r.status.value] += 1
        alerts = [r for r in results if r.is_alert]
        executed = sum(1 for r in results if r.status is not TestStatus.PENDING)
        return {
            "total": len(results),
            "executed": executed,
            "pending": counts[TestStatus.PENDING.value],
            "passed": counts[TestStatus.PASS.value],
            "failed": counts[TestStatus.FAIL.value],
            "inconclusive": counts[TestStatus.INCONCLUSIVE.value],
            "alerts": len(alerts),
            "risk_score": evaluator.risk_score(results),
        }
