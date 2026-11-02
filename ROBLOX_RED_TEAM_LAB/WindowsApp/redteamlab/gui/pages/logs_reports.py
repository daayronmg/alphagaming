"""Logs & Reports page: import a result log, export JSON/CSV/HTML."""
from __future__ import annotations

from typing import Callable

from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget,
)


class LogsReportsPage(QWidget):
    def __init__(self, on_import: Callable[[], None], on_export: Callable[[], None]) -> None:
        super().__init__()
        v = QVBoxLayout(self)
        v.setContentsMargins(28, 24, 28, 24)

        title = QLabel("Logs & Reports")
        title.setObjectName("H1")
        v.addWidget(title)

        desc = QLabel(
            "Importa el log JSON generado por el harness Luau de tu experiencia y exporta el "
            "informe en JSON, CSV y HTML. No se inventan resultados: solo se evaluan los registros "
            "aportados."
        )
        desc.setObjectName("Muted")
        desc.setWordWrap(True)
        v.addWidget(desc)

        row = QHBoxLayout()
        imp = QPushButton("Importar resultados (JSON)…")
        imp.setObjectName("Primary")
        imp.clicked.connect(on_import)
        exp = QPushButton("Exportar informes…")
        exp.clicked.connect(on_export)
        row.addWidget(imp)
        row.addWidget(exp)
        row.addStretch(1)
        v.addLayout(row)
        v.addStretch(1)

    def refresh(self) -> None:  # symmetry with other pages
        pass
