"""Dashboard: stat cards + lab scope note."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame, QGridLayout, QLabel, QVBoxLayout, QWidget,
)

from ...registry import Lab

_CARDS = [
    ("total", "Pruebas totales"),
    ("executed", "Ejecutadas"),
    ("passed", "PASS"),
    ("failed", "FAIL"),
    ("inconclusive", "INCONCLUSIVE"),
    ("pending", "Pendientes"),
    ("alerts", "Alertas"),
    ("risk_score", "Riesgo /100"),
]


class _Card(QFrame):
    def __init__(self, label: str) -> None:
        super().__init__()
        self.setProperty("class", "Card")
        self.setStyleSheet("QFrame{background:#1b1f27;border:1px solid #262b35;border-radius:10px;}")
        v = QVBoxLayout(self)
        self.num = QLabel("0")
        self.num.setObjectName("CardNum")
        lbl = QLabel(label)
        lbl.setObjectName("CardLbl")
        v.addWidget(self.num)
        v.addWidget(lbl)


class DashboardPage(QWidget):
    def __init__(self, lab: Lab) -> None:
        super().__init__()
        self.lab = lab
        v = QVBoxLayout(self)
        v.setContentsMargins(28, 24, 28, 24)

        title = QLabel("Estado del laboratorio")
        title.setObjectName("H1")
        v.addWidget(title)

        grid = QGridLayout()
        grid.setSpacing(12)
        self._cards: dict[str, _Card] = {}
        for i, (key, label) in enumerate(_CARDS):
            card = _Card(label)
            self._cards[key] = card
            grid.addWidget(card, i // 4, i % 4)
        v.addLayout(grid)

        note = QLabel(
            "Alcance: experiencia Roblox propia y autorizada. El cliente es no confiable; el servidor "
            "es la autoridad. Una deteccion solo se atribuye a Hyperion con evidencia verificable. "
            "Las pruebas sin resultado figuran como PENDING; ejecutar codigo no equivale a PASS."
        )
        note.setObjectName("Muted")
        note.setWordWrap(True)
        v.addWidget(note)
        v.addStretch(1)
        self.refresh()

    def refresh(self) -> None:
        st = self.lab.stats()
        for key, card in self._cards.items():
            card.num.setText(str(st.get(key, 0)))
