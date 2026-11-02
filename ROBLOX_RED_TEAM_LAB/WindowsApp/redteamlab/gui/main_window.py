"""Main window: sidebar navigation + stacked pages, all fed by one Lab."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup, QFileDialog, QHBoxLayout, QLabel, QMessageBox, QPushButton,
    QStackedWidget, QVBoxLayout, QWidget,
)

from .. import __version__, ingest
from ..models import Category
from ..registry import Lab
from ..reporting import write_all
from .pages.dashboard import DashboardPage
from .pages.logs_reports import LogsReportsPage
from .pages.scenario_page import ScenarioPage


class MainWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("ROBLOX RED TEAM LAB")
        self.resize(1180, 720)
        self.lab = Lab()
        self._buttons: dict[str, QPushButton] = {}

        root = QHBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ---- sidebar ----
        sidebar = QWidget()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(230)
        sv = QVBoxLayout(sidebar)
        sv.setContentsMargins(0, 0, 0, 0)
        sv.setSpacing(0)

        brand = QLabel("ROBLOX RED TEAM LAB")
        brand.setObjectName("Brand")
        brand.setWordWrap(True)
        sub = QLabel("Auditoria autorizada · servidor = autoridad")
        sub.setObjectName("Subtitle")
        sub.setWordWrap(True)
        sv.addWidget(brand)
        sv.addWidget(sub)

        self.stack = QStackedWidget()
        self.pages: dict[str, QWidget] = {}
        self._btn_group = QButtonGroup(self)
        self._btn_group.setExclusive(True)

        self._add_page("Dashboard", DashboardPage(self.lab))
        self._add_page("Movement", ScenarioPage(self.lab, Category.MOVEMENT))
        self._add_page("RemoteEvents", ScenarioPage(self.lab, Category.REMOTE))
        self._add_page("Economy", ScenarioPage(self.lab, Category.ECONOMY))
        self._add_page("Permissions", ScenarioPage(self.lab, Category.PERMISSIONS))
        self._add_page("Logs & Reports",
                       LogsReportsPage(on_import=self.import_results, on_export=self.export_reports))

        for i, (name, btn) in enumerate(self._buttons.items()):
            sv.addWidget(btn)
            btn.clicked.connect(lambda _=False, idx=i: self._go(idx))
        sv.addStretch(1)
        ver = QLabel(f"v{__version__}")
        ver.setObjectName("Subtitle")
        sv.addWidget(ver)

        root.addWidget(sidebar)
        root.addWidget(self.stack, 1)

        first = next(iter(self._buttons.values()))
        first.setChecked(True)
        self._go(0)

    # ------------------------------------------------------------------
    def _add_page(self, name: str, widget: QWidget) -> None:
        btn = QPushButton(name)
        btn.setCheckable(True)
        self._btn_group.addButton(btn)
        self._buttons[name] = btn
        self.pages[name] = widget
        self.stack.addWidget(widget)

    def _go(self, idx: int) -> None:
        self.stack.setCurrentIndex(idx)
        list(self._buttons.values())[idx].setChecked(True)
        self._refresh_all()

    def _refresh_all(self) -> None:
        for page in self.pages.values():
            if hasattr(page, "refresh"):
                page.refresh()

    # ------------------------------------------------------------------
    def import_results(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Importar log de resultados", "", "JSON (*.json)")
        if not path:
            return
        try:
            records = ingest.load_records(path)
        except ingest.IngestError as exc:
            QMessageBox.critical(self, "Error de importacion", str(exc))
            return
        unknown = self.lab.apply_records(records)
        self._refresh_all()
        msg = f"Importados {len(records)} registro(s)."
        if unknown:
            msg += f"\nIgnorados ids desconocidos: {', '.join(sorted(set(unknown)))}"
        QMessageBox.information(self, "Importacion completa", msg)

    def export_reports(self) -> None:
        out = QFileDialog.getExistingDirectory(self, "Carpeta de salida para informes")
        if not out:
            return
        paths = write_all(self.lab, out, basename="report")
        QMessageBox.information(
            self, "Informes generados",
            "\n".join(f"{k.upper()}: {p}" for k, p in paths.items()),
        )
