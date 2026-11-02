"""Core data model for the lab.

Everything here is plain dataclasses + enums with no third-party deps, so the
model is trivially unit-testable and reusable by the CLI, the GUI and the
report generators alike.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


class Category(str, enum.Enum):
    MOVEMENT = "movement"
    REMOTE = "remote"
    ECONOMY = "economy"
    PERMISSIONS = "permissions"


class TestStatus(str, enum.Enum):
    """Outcome of a test *after evaluation*.

    PENDING is the default: a scenario that has never produced a result log is
    pending, never "passed". Executing code is not the same as passing.
    """
    PENDING = "PENDING"
    PASS = "PASS"
    FAIL = "FAIL"
    INCONCLUSIVE = "INCONCLUSIVE"


class Severity(str, enum.Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# Numeric weight used for aggregate risk scoring (0..100 bands).
SEVERITY_WEIGHT = {
    Severity.INFO: 0,
    Severity.LOW: 25,
    Severity.MEDIUM: 50,
    Severity.HIGH: 75,
    Severity.CRITICAL: 100,
}


class DetectionSource(str, enum.Enum):
    """Who/what reacted to the anomalous input.

    Honesty rule (see Documentation/LIMITATIONS.md): HYPERION must never be
    inferred. It may only be set when a result log carries verifiable evidence
    that Hyperion itself reacted. Anything else is SERVER_REJECT (the
    experience's own server-side validation), CUSTOM_DETECTOR (the lab's
    telemetry/risk module), NONE (nothing reacted) or UNKNOWN.
    """
    HYPERION = "HYPERION"
    SERVER_REJECT = "SERVER_REJECT"
    CUSTOM_DETECTOR = "CUSTOM_DETECTOR"
    NONE = "NONE"
    UNKNOWN = "UNKNOWN"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Scenario:
    """A reproducible security test definition (pure data, no attack code).

    A scenario describes an anomalous/unauthorized input and the *secure*
    behavior expected from the operator's own server. `expect_rejected=True`
    means: a correctly defended server must reject or correct this input.
    """
    id: str
    name: str
    category: Category
    description: str
    objective: str
    initial_conditions: str
    procedure: str
    expected_result: str
    severity_if_failed: Severity = Severity.MEDIUM
    expect_rejected: bool = True
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["category"] = self.category.value
        d["severity_if_failed"] = self.severity_if_failed.value
        return d


@dataclass
class TestResult:
    """The evaluated outcome of running a scenario via the Luau harness."""
    scenario_id: str
    status: TestStatus = TestStatus.PENDING
    run_id: str = ""
    timestamp: str = field(default_factory=_now_iso)
    observed_behavior: str = ""
    server_response: str = ""
    detection_source: DetectionSource = DetectionSource.UNKNOWN
    evidence: list[str] = field(default_factory=list)
    severity: Severity = Severity.INFO
    recommendation: str = ""
    obtained_result: str = ""
    # Raw record as ingested, kept for traceability / audit.
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        d["detection_source"] = self.detection_source.value
        d["severity"] = self.severity.value
        return d

    @property
    def is_alert(self) -> bool:
        """An alert is a FAIL at MEDIUM or above (a real exposure)."""
        return self.status is TestStatus.FAIL and SEVERITY_WEIGHT[self.severity] >= 50


@dataclass
class LabMeta:
    app: str = "ROBLOX RED TEAM LAB"
    version: str = "1.0.0"
    generated_at: str = field(default_factory=_now_iso)
    operator_note: str = (
        "Authorized testing of the operator's own Roblox experience. "
        "Client is treated as untrusted; the server is the authority."
    )
