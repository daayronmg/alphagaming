import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import _bootstrap  # noqa: F401

from redteamlab import cli


class TestCli(unittest.TestCase):
    def test_version(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["version"])
        self.assertEqual(rc, 0)
        self.assertIn("ROBLOX RED TEAM LAB", buf.getvalue())

    def test_list_scenarios(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["list-scenarios"])
        self.assertEqual(rc, 0)
        self.assertIn("MOV-001", buf.getvalue())

    def test_list_scenarios_filter(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["list-scenarios", "--category", "economy"])
        self.assertEqual(rc, 0)
        out = buf.getvalue()
        self.assertIn("ECO-001", out)
        self.assertNotIn("MOV-001", out)

    def test_demo_generates_reports(self):
        out = Path(tempfile.mkdtemp())
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["demo", "--out", str(out)])
        self.assertEqual(rc, 0)
        for name in ["demo_report.json", "demo_report.csv", "demo_report.html"]:
            self.assertTrue((out / name).exists(), name)

    def test_import_missing_file_returns_error(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["import", "--results", "/no/such.json", "--out", tempfile.mkdtemp()])
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
