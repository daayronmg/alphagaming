import unittest

import _bootstrap  # noqa: F401

from redteamlab.models import TestStatus
from redteamlab.registry import Lab


class TestRegistry(unittest.TestCase):
    def test_all_pending_by_default(self):
        lab = Lab()
        results = lab.all_results()
        self.assertTrue(all(r.status is TestStatus.PENDING for r in results))
        st = lab.stats()
        self.assertEqual(st["pending"], st["total"])
        self.assertEqual(st["executed"], 0)
        self.assertEqual(st["risk_score"], 0)

    def test_apply_records_mixed(self):
        lab = Lab()
        unknown = lab.apply_records([
            {"scenario_id": "MOV-001", "server_rejected": True},
            {"scenario_id": "ECO-001", "server_rejected": False},
            {"scenario_id": "ECO-004"},                      # inconclusive
            {"scenario_id": "DOES-NOT-EXIST", "server_rejected": True},
        ])
        self.assertEqual(unknown, ["DOES-NOT-EXIST"])
        st = lab.stats()
        self.assertEqual(st["passed"], 1)
        self.assertEqual(st["failed"], 1)
        self.assertEqual(st["inconclusive"], 1)
        self.assertGreaterEqual(st["executed"], 3)
        self.assertGreaterEqual(st["alerts"], 1)   # ECO-001 is CRITICAL fail

    def test_result_for_unknown_scenario(self):
        lab = Lab()
        r = lab.result_for("MOV-004")
        self.assertIs(r.status, TestStatus.PENDING)


if __name__ == "__main__":
    unittest.main()
