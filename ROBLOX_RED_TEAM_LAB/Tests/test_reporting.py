import csv
import json
import tempfile
import unittest
from pathlib import Path

import _bootstrap  # noqa: F401

from redteamlab.registry import Lab
from redteamlab.reporting import write_all, write_csv, write_html, write_json


class TestReporting(unittest.TestCase):
    def setUp(self):
        self.lab = Lab()
        self.lab.apply_records([
            {"scenario_id": "MOV-001", "server_rejected": True, "detection_source": "SERVER_REJECT"},
            {"scenario_id": "ECO-001", "server_rejected": False},
        ])
        self.out = Path(tempfile.mkdtemp())

    def test_json_report_shape(self):
        p = write_json(self.lab, self.out / "r.json")
        data = json.loads(p.read_text(encoding="utf-8"))
        self.assertIn("meta", data)
        self.assertIn("stats", data)
        self.assertEqual(len(data["results"]), len(self.lab.scenarios))

    def test_csv_report_has_rows(self):
        p = write_csv(self.lab, self.out / "r.csv")
        with p.open(encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        self.assertEqual(len(rows), len(self.lab.scenarios))
        self.assertIn("status", rows[0])

    def test_html_report_is_html(self):
        p = write_html(self.lab, self.out / "r.html")
        txt = p.read_text(encoding="utf-8")
        self.assertIn("<!DOCTYPE html>", txt)
        self.assertIn("ROBLOX RED TEAM LAB", txt)
        # XSS-safety: content is escaped (no raw unescaped angle-tags from data)
        self.assertIn("PASS", txt)

    def test_write_all(self):
        paths = write_all(self.lab, self.out, basename="bundle")
        self.assertEqual(set(paths), {"json", "csv", "html"})
        for p in paths.values():
            self.assertTrue(p.exists())


if __name__ == "__main__":
    unittest.main()
