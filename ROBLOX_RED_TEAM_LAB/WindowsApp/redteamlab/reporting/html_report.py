from __future__ import annotations

import html
from pathlib import Path

from ..models import TestStatus
from ..registry import Lab

_STATUS_COLOR = {
    "PASS": "#2ecc71",
    "FAIL": "#e74c3c",
    "INCONCLUSIVE": "#f39c12",
    "PENDING": "#7f8c8d",
}


def _esc(x) -> str:
    return html.escape(str(x), quote=True)


def write_html(lab: Lab, path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    st = lab.stats()
    by_id = {s.id: s for s in lab.scenarios}

    cards = "".join(
        f'<div class="card"><div class="num">{st[k]}</div><div class="lbl">{lbl}</div></div>'
        for k, lbl in [
            ("total", "Total"), ("executed", "Ejecutadas"), ("passed", "PASS"),
            ("failed", "FAIL"), ("inconclusive", "INCONCLUSIVE"),
            ("pending", "Pendientes"), ("alerts", "Alertas"), ("risk_score", "Riesgo /100"),
        ]
    )

    rows = []
    for r in lab.all_results():
        sc = by_id.get(r.scenario_id)
        color = _STATUS_COLOR.get(r.status.value, "#999")
        rows.append(
            "<tr>"
            f"<td>{_esc(r.scenario_id)}</td>"
            f"<td>{_esc(sc.name if sc else '')}</td>"
            f"<td>{_esc(sc.category.value if sc else '')}</td>"
            f'<td><span class="badge" style="background:{color}">{_esc(r.status.value)}</span></td>'
            f"<td>{_esc(r.severity.value)}</td>"
            f"<td>{_esc(r.detection_source.value)}</td>"
            f"<td>{_esc(r.observed_behavior)}</td>"
            f"<td>{_esc(r.obtained_result)}</td>"
            f"<td>{_esc(' | '.join(r.evidence))}</td>"
            f"<td>{_esc(r.recommendation)}</td>"
            "</tr>"
        )

    doc = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ROBLOX RED TEAM LAB - Informe</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; background:#0f1115; color:#e6e6e6;
         font-family:Segoe UI, Roboto, system-ui, sans-serif; }}
  header {{ padding:24px 32px; border-bottom:1px solid #222;
            background:#15181f; }}
  header h1 {{ margin:0; font-size:20px; letter-spacing:1px; }}
  header p {{ margin:4px 0 0; color:#9aa0a6; font-size:13px; }}
  .cards {{ display:flex; flex-wrap:wrap; gap:12px; padding:24px 32px; }}
  .card {{ background:#1b1f27; border:1px solid #262b35; border-radius:10px;
           padding:16px 20px; min-width:110px; }}
  .card .num {{ font-size:26px; font-weight:700; }}
  .card .lbl {{ color:#9aa0a6; font-size:12px; margin-top:4px; }}
  table {{ width:calc(100% - 64px); margin:0 32px 40px; border-collapse:collapse;
           font-size:13px; }}
  th, td {{ text-align:left; padding:10px 12px; border-bottom:1px solid #222;
            vertical-align:top; }}
  th {{ color:#9aa0a6; font-weight:600; position:sticky; top:0; background:#15181f; }}
  .badge {{ padding:2px 8px; border-radius:6px; color:#0b0b0b; font-weight:700;
            font-size:11px; }}
  .note {{ margin:0 32px 32px; padding:14px 16px; background:#1b1f27;
           border:1px solid #262b35; border-radius:10px; color:#c6ccd4;
           font-size:12px; }}
</style></head>
<body>
<header>
  <h1>ROBLOX RED TEAM LAB</h1>
  <p>Informe de evaluacion de seguridad &middot; Generado: {_esc(lab.meta.generated_at)} &middot; v{_esc(lab.meta.version)}</p>
</header>
<div class="cards">{cards}</div>
<div class="note">
  Alcance: pruebas sobre una experiencia Roblox propia y autorizada. El cliente se trata como no confiable; el
  servidor es la autoridad. Una deteccion solo se atribuye a Hyperion con evidencia verificable; en caso contrario
  se registra como SERVER_REJECT, CUSTOM_DETECTOR, NONE o UNKNOWN. Las pruebas sin resultado figuran como PENDING.
</div>
<table>
  <thead><tr>
    <th>ID</th><th>Escenario</th><th>Modulo</th><th>Estado</th><th>Gravedad</th>
    <th>Deteccion</th><th>Comportamiento observado</th><th>Resultado obtenido</th>
    <th>Evidencia</th><th>Recomendacion</th>
  </tr></thead>
  <tbody>
    {''.join(rows)}
  </tbody>
</table>
</body></html>"""
    p.write_text(doc, encoding="utf-8")
    return p
