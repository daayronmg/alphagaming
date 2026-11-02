"""A category page: a table of scenarios with their current evaluated result.

The same class serves Movement / RemoteEvents / Economy / Permissions; it is
read-only over the Lab (the lab is populated by importing a Luau result log).
"""
from __future__ import annotations

from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QHeaderView, QLabel, QTableWidget, QTableWidgetItem,
    QVBoxLayout, QWidget,
)

from ...models import Category
from ...registry import Lab
from ..theme import STATUS_COLORS

_HEADERS = ["ID", "Escenario", "Estado", "Gravedad", "Deteccion", "Resultado obtenido", "Recomendacion"]


class ScenarioPage(QWidget):
    def __init__(self, lab: Lab, category: Category) -> None:
        super().__init__()
        self.lab = lab
        self.category = category

        v = QVBoxLayout(self)
        v.setContentsMargins(28, 24, 28, 24)
        title = QLabel(category.value.capitalize() + " testing")
        title.setObjectName("H1")
        v.addWidget(title)

        hint = QLabel(
            "Escenarios reproducibles. El resultado se rellena importando el log del harness "
            "(Logs & Reports → Importar). Sin log, el estado es PENDING."
        )
        hint.setObjectName("Muted")
        hint.setWordWrap(True)
        v.addWidget(hint)

        self.table = QTableWidget(0, len(_HEADERS))
        self.table.setHorizontalHeaderLabels(_HEADERS)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.table.horizontalHeader().setStretchLastSection(True)
        v.addWidget(self.table, 1)
        self.refresh()

    def refresh(self) -> None:
        scenarios = self.lab.scenarios_in(self.category)
        self.table.setRowCount(len(scenarios))
        for row, sc in enumerate(scenarios):
            r = self.lab.result_for(sc.id)
            cells = [
                sc.id, sc.name, r.status.value, r.severity.value,
                r.detection_source.value, r.obtained_result, r.recommendation,
            ]
            for col, text in enumerate(cells):
                item = QTableWidgetItem(str(text))
                if col == 2:  # status column -> color
                    item.setForeground(QColor(STATUS_COLORS.get(r.status.value, "#e6e6e6")))
                self.table.setItem(row, col, item)
        self.table.resizeColumnsToContents()
