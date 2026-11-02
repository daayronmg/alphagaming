"""Dark theme (QSS) for the application."""

DARK_QSS = """
* { font-family: "Segoe UI", "Roboto", sans-serif; font-size: 13px; }
QWidget { background: #0f1115; color: #e6e6e6; }
QMainWindow { background: #0f1115; }

#Sidebar { background: #15181f; border-right: 1px solid #222; }
#Sidebar QPushButton {
    text-align: left; padding: 11px 18px; border: none; color: #c6ccd4;
    background: transparent; border-radius: 0;
}
#Sidebar QPushButton:hover { background: #1b1f27; }
#Sidebar QPushButton:checked { background: #202634; color: #ffffff; border-left: 3px solid #4f8cff; }

#Brand { font-size: 15px; font-weight: 700; letter-spacing: 1px; padding: 18px; color: #ffffff; }
#Subtitle { color: #7f8c8d; padding: 0 18px 12px; font-size: 11px; }

.Card { background: #1b1f27; border: 1px solid #262b35; border-radius: 10px; }
#CardNum { font-size: 26px; font-weight: 700; }
#CardLbl { color: #9aa0a6; font-size: 12px; }

QTableWidget { background: #141821; border: 1px solid #262b35; gridline-color: #222;
               selection-background-color: #243049; }
QHeaderView::section { background: #15181f; color: #9aa0a6; padding: 6px 8px;
                       border: none; border-bottom: 1px solid #262b35; }
QTableWidget::item { padding: 4px 6px; }

QPushButton#Primary { background: #2f6fed; color: white; border: none; padding: 8px 16px;
                      border-radius: 8px; font-weight: 600; }
QPushButton#Primary:hover { background: #3b7bff; }
QPushButton { background: #232936; color: #e6e6e6; border: 1px solid #2d3444;
              padding: 7px 14px; border-radius: 8px; }
QPushButton:hover { background: #2a3140; }

QPlainTextEdit, QTextEdit { background: #0c0e13; border: 1px solid #262b35; border-radius: 8px;
                            color: #cfd6e0; }
QLabel#H1 { font-size: 18px; font-weight: 700; }
QLabel#Muted { color: #8a919b; }
"""

STATUS_COLORS = {
    "PASS": "#2ecc71",
    "FAIL": "#e74c3c",
    "INCONCLUSIVE": "#f39c12",
    "PENDING": "#7f8c8d",
}
