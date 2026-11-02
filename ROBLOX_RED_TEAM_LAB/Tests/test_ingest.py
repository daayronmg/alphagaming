import json
import tempfile
import unittest
from pathlib import Path

import _bootstrap  # noqa: F401

from redteamlab import ingest


class TestIngest(unittest.TestCase):
    def _tmp(self, text: str) -> Path:
        d = Path(tempfile.mkdtemp())
        p = d / "r.json"
        p.write_text(text, encoding="utf-8")
        return p

    def test_list_form(self):
        p = self._tmp(json.dumps([{"scenario_id": "MOV-001"}]))
        self.assertEqual(len(ingest.load_records(p)), 1)

    def test_object_form(self):
        p = self._tmp(json.dumps({"results": [{"scenario_id": "MOV-001"}, {"scenario_id": "ECO-001"}]}))
        self.assertEqual(len(ingest.load_records(p)), 2)

    def test_skips_records_without_scenario_id(self):
        p = self._tmp(json.dumps({"results": [{"scenario_id": "MOV-001"}, {"nope": 1}, 42]}))
        self.assertEqual(len(ingest.load_records(p)), 1)

    def test_missing_file(self):
        with self.assertRaises(ingest.IngestError):
            ingest.load_records("/no/such/file.json")

    def test_bad_json(self):
        p = self._tmp("{not json")
        with self.assertRaises(ingest.IngestError):
            ingest.load_records(p)

    def test_wrong_toplevel(self):
        p = self._tmp(json.dumps(42))
        with self.assertRaises(ingest.IngestError):
            ingest.load_records(p)


if __name__ == "__main__":
    unittest.main()
