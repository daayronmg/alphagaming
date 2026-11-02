"""Make the WindowsApp package importable from the Tests/ directory."""
import pathlib
import sys

APP = pathlib.Path(__file__).resolve().parents[1] / "WindowsApp"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
