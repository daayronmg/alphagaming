import unittest

import _bootstrap  # noqa: F401

from redteamlab.models import Category
from redteamlab.scenarios import builtin_scenarios, scenarios_by_id, scenarios_in


class TestScenarios(unittest.TestCase):
    def test_unique_ids(self):
        ids = [s.id for s in builtin_scenarios()]
        self.assertEqual(len(ids), len(set(ids)), "scenario ids must be unique")

    def test_all_categories_present(self):
        cats = {s.category for s in builtin_scenarios()}
        self.assertEqual(cats, set(Category))

    def test_lookup(self):
        by_id = scenarios_by_id()
        self.assertIn("MOV-001", by_id)
        self.assertEqual(by_id["MOV-001"].category, Category.MOVEMENT)

    def test_filter_by_category(self):
        mov = scenarios_in(Category.MOVEMENT)
        self.assertTrue(mov)
        self.assertTrue(all(s.category is Category.MOVEMENT for s in mov))

    def test_scenarios_expect_rejection(self):
        # Every built-in scenario describes an anomalous input a secure server must reject.
        self.assertTrue(all(s.expect_rejected for s in builtin_scenarios()))


if __name__ == "__main__":
    unittest.main()
