"""QApplication bootstrap."""
from __future__ import annotations

import sys


def run() -> int:
    from PySide6.QtWidgets import QApplication

    from .main_window import MainWindow
    from .theme import DARK_QSS

    app = QApplication(sys.argv)
    app.setApplicationName("ROBLOX RED TEAM LAB")
    app.setStyleSheet(DARK_QSS)
    win = MainWindow()
    win.show()
    return app.exec()
