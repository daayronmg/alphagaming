"""Turn raw harness result records into evaluated TestResult objects.

Evaluation policy (deliberately conservative and honest):

  * A scenario describes an anomalous input that a *secure* server must reject
    (scenario.expect_rejected == True).
  * If the harness record proves the server rejected/corrected it  -> PASS
    (the defense worked).
  * If the record proves the server accepted it                    -> FAIL
    (a real exposure; severity taken from the scenario).
  * If the record cannot establish either way (missing evidence, requires
    access we do not have, malformed record)                       -> INCONCLUSIVE.
  * No record at all                                               -> PENDING.

We never upgrade an INCONCLUSIVE to PASS, and we never attribute a detection to
Hyperion unless the record carries verifiable Hyperion evidence.
"""
from __future__ import annotations

import math
from typing import Any, Optional

from .models import (
    DetectionSource,
    Scenario,
    Severity,
    SEVERITY_WEIGHT,
    TestResult,
    TestStatus,
)


def _coerce_detection(value: Any) -> DetectionSource:
    if value is None:
        return DetectionSource.UNKNOWN
    try:
        return DetectionSource(str(value).strip().upper())
    except ValueError:
        # Unknown label -> never silently treat as Hyperion.
        return DetectionSource.UNKNOWN


def _tri_bool(value: Any) -> Optional[bool]:
    """Interpret a possibly-missing 'server_rejected' field as True/False/None."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return bool(value)
    s = str(value).strip().lower()
    if s in ("true", "yes", "1", "rejected", "denied", "blocked", "corrected"):
        return True
    if s in ("false", "no", "0", "accepted", "allowed", "applied"):
        return False
    return None


def evaluate_record(scenario: Scenario, record: dict[str, Any]) -> TestResult:
    """Evaluate a single raw record against its scenario."""
    detection = _coerce_detection(record.get("detection_source"))
    rejected = _tri_bool(record.get("server_rejected"))
    evidence = record.get("evidence") or []
    if isinstance(evidence, str):
        evidence = [evidence]
    evidence = [str(e) for e in evidence]

    result = TestResult(
        scenario_id=scenario.id,
        run_id=str(record.get("run_id", "")),
        timestamp=str(record.get("timestamp", "")) or TestResult(scenario_id=scenario.id).timestamp,
        observed_behavior=str(record.get("observed", record.get("observed_behavior", ""))),
        server_response=str(record.get("server_response", "")),
        detection_source=detection,
        evidence=evidence,
        raw=record,
    )

    # Honesty guard: a Hyperion attribution requires explicit evidence.
    if detection is DetectionSource.HYPERION and not evidence:
        result.detection_source = DetectionSource.UNKNOWN
        result.evidence.append(
            "Downgraded detection_source from HYPERION to UNKNOWN: no verifiable evidence provided."
        )

    # Decide status.
    if rejected is None:
        result.status = TestStatus.INCONCLUSIVE
        result.severity = Severity.MEDIUM
        result.obtained_result = (
            "Could not establish whether the server rejected the input from this record."
        )
        result.recommendation = (
            "Add explicit server-side logging (server_rejected + evidence) for this scenario "
            "and re-run, or mark why it cannot be measured."
        )
        return result

    secure = (rejected == scenario.expect_rejected)
    if secure:
        result.status = TestStatus.PASS
        result.severity = Severity.LOW if result.detection_source is DetectionSource.NONE else Severity.INFO
        result.obtained_result = "Server behaved securely (anomalous input was rejected/corrected)."
        result.recommendation = "No action required. Keep the control under regression testing."
    else:
        result.status = TestStatus.FAIL
        result.severity = scenario.severity_if_failed
        result.obtained_result = "Server accepted an input it should have rejected (exposure)."
        result.recommendation = (
            f"Implement/repair server-side validation for '{scenario.name}'. "
            "Treat the client as untrusted and enforce this check on the server."
        )
    return result


def pending_result(scenario: Scenario) -> TestResult:
    r = TestResult(scenario_id=scenario.id, status=TestStatus.PENDING)
    r.obtained_result = "Not executed yet."
    r.recommendation = "Run the Luau self-test harness for this scenario to produce a result."
    r.severity = Severity.INFO
    return r


def risk_score(results: list[TestResult]) -> int:
    """Aggregate 0..100 risk score.

    Only FAIL results contribute exposure. INCONCLUSIVE adds mild uncertainty.
    PASS/PENDING add nothing. Score is the capped weighted exposure.
    """
    if not results:
        return 0
    exposure = 0
    for r in results:
        if r.status is TestStatus.FAIL:
            exposure += SEVERITY_WEIGHT[r.severity]
        elif r.status is TestStatus.INCONCLUSIVE:
            exposure += 10
    # Normalize against a soft ceiling so a few criticals dominate sensibly.
    return min(100, exposure)
