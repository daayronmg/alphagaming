# Manual de uso

## Flujo de trabajo completo

1. **Instala los módulos Luau** en tu experiencia propia (ver
   [`ROBLOX_SETUP.md`](ROBLOX_SETUP.md)).
2. **Ejecuta el harness** `RTL_SelfTest` en Studio. Imprime un log JSON de
   resultados con el estado real de cada defensa.
3. **Copia ese JSON** a un archivo (p. ej. `mis_resultados.json`).
4. **Importa el log** en la app (GUI o CLI) y **genera el informe**.

## CLI (headless)

```bash
# Escenarios integrados
python3 WindowsApp/run_cli.py list-scenarios
python3 WindowsApp/run_cli.py list-scenarios --category economy

# Estadísticas del panel a partir de un log
python3 WindowsApp/run_cli.py stats --results mis_resultados.json

# Ingesta un log y genera JSON + CSV + HTML
python3 WindowsApp/run_cli.py import --results mis_resultados.json --out Reports --basename auditoria_2026_11

# Demostración con el log de ejemplo incluido
python3 WindowsApp/run_cli.py demo
```

## GUI

`python WindowsApp/run_gui.py` abre la ventana con navegación lateral:

- **Dashboard** — totales, PASS/FAIL/INCONCLUSIVE/PENDING, alertas y riesgo /100.
- **Movement / RemoteEvents / Economy / Permissions** — tabla de escenarios y su
  resultado evaluado (PENDING hasta importar un log).
- **Logs & Reports** — *Importar resultados (JSON)* y *Exportar informes*.

## Formato del log de resultados

Un archivo JSON con una lista `results`; cada registro:

```json
{
  "scenario_id": "MOV-001",
  "run_id": "studio-20261102T100000Z",
  "timestamp": "2026-11-02T10:00:01+00:00",
  "server_rejected": true,
  "detection_source": "SERVER_REJECT",
  "observed": "velocidad 180 recortada a 24; snapback",
  "server_response": "MovementValidator rechazó la actualización",
  "evidence": ["server-log: speed=180 > max=24 -> reject"]
}
```

Reglas de evaluación:

- `server_rejected: true` para un escenario cuyo comportamiento seguro es
  rechazar → **PASS**.
- `server_rejected: false` → **FAIL** (con la gravedad del escenario).
- `server_rejected` ausente/indeterminable → **INCONCLUSIVE**.
- Sin registro para un escenario → **PENDING**.
- `detection_source: "HYPERION"` **sin** `evidence` → se degrada a `UNKNOWN`.

Valores aceptados de `detection_source`: `SERVER_REJECT`, `CUSTOM_DETECTOR`,
`HYPERION` (solo con evidencia), `NONE`, `UNKNOWN`.
