import unittest

import _bootstrap  # noqa: F401

from redteamlab.evaluator import evaluate_record, pending_result, risk_score
from redteamlab.models import DetectionSource, Severity, TestStatus
from redteamlab.scenarios import scenarios_by_id

S = scenarios_by_id()


class TestEvaluator(unittest.TestCase):
    def test_rejected_is_pass(self):
        r = evaluate_record(S["MOV-001"], {"scenario_id": "MOV-001", "server_rejected": True,
                                           "detection_source": "SERVER_REJECT", "evidence": ["x"]})
        self.assertIs(r.status, TestStatus.PASS)

    def test_accepted_is_fail_with_scenario_severity(self):
        r = evaluate_record(S["ECO-001"], {"scenario_id": "ECO-001", "server_rejected": False})
        self.assertIs(r.status, TestStatus.FAIL)
        self.assertIs(r.severity, Severity.CRITICAL)
        self.assertTrue(r.is_alert)

    def test_missing_rejection_is_inconclusive(self):
        r = evaluate_record(S["ECO-004"], {"scenario_id": "ECO-004"})
        self.assertIs(r.status, TestStatus.INCONCLUSIVE)

    def test_nan_rejection_is_inconclusive(self):
        r = evaluate_record(S["ECO-004"], {"scenario_id": "ECO-004", "server_rejected": float("nan")})
        self.assertIs(r.status, TestStatus.INCONCLUSIVE)

    def test_hyperion_without_evidence_is_downgraded(self):
        r = evaluate_record(S["PRM-003"], {"scenario_id": "PRM-003", "server_rejected": True,
                                           "detection_source": "HYPERION", "evidence": []})
        self.assertIs(r.detection_source, DetectionSource.UNKNOWN)
        self.assertTrue(any("Downgraded" in e for e in r.evidence))

    def test_hyperion_with_evidence_is_kept(self):
        r = evaluate_record(S["PRM-003"], {"scenario_id": "PRM-003", "server_rejected": True,
                                           "detection_source": "HYPERION",
                                           "evidence": ["verifiable hyperion signal"]})
        self.assertIs(r.detection_source, DetectionSource.HYPERION)

    def test_unknown_detection_label_not_hyperion(self):
        r = evaluate_record(S["MOV-001"], {"scenario_id": "MOV-001", "server_rejected": True,
                                           "detection_source": "magic"})
        self.assertIs(r.detection_source, DetectionSource.UNKNOWN)

    def test_string_rejection_values(self):
        for val, expected in [("accepted", TestStatus.FAIL), ("denied", TestStatus.PASS)]:
            r = evaluate_record(S["RMT-001"], {"scenario_id": "RMT-001", "server_rejected": val})
            self.assertIs(r.status, expected, val)

    def test_pending(self):
        r = pending_result(S["MOV-004"])
        self.assertIs(r.status, TestStatus.PENDING)

    def test_risk_score_bounds_and_direction(self):
        self.assertEqual(risk_score([]), 0)
        clean = [evaluate_record(S["MOV-001"], {"scenario_id": "MOV-001", "server_rejected": True})]
        exposed = [evaluate_record(S["ECO-001"], {"scenario_id": "ECO-001", "server_rejected": False})]
        self.assertEqual(risk_score(clean), 0)
        self.assertGreater(risk_score(exposed), risk_score(clean))
        self.assertLessEqual(risk_score(exposed), 100)


if __name__ == "__main__":
    unittest.main()
