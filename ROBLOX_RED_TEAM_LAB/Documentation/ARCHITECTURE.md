# Arquitectura

```
                 ┌───────────────────────────┐
                 │  Tu experiencia Roblox      │  (propia, autorizada)
                 │  ─ RTL_* validadores        │
                 │  ─ RTL_Bootstrap (RemoteEv.) │
                 │  ─ RTL_SelfTest (harness)    │ ── produce ──► log JSON
                 └───────────────────────────┘
                                                        │
                                                        ▼ (importar)
   ┌──────────────────────────────────────────────────────────────┐
   │  WindowsApp (Python)                                           │
   │                                                                │
   │   gui/ (PySide6)         cli.py (headless)                     │
   │        │                      │                                │
   │        └──────────┬───────────┘                                │
   │                   ▼                                            │
   │   registry.Lab  ──►  evaluator  ──►  reporting (JSON/CSV/HTML) │
   │        ▲               ▲                                       │
   │   scenarios.py     ingest.py (lee el log JSON)                 │
   │   models.py (dataclasses + enums)                              │
   └──────────────────────────────────────────────────────────────┘
```

## Capas

### Núcleo (`redteamlab/`, sin dependencias)
- **`models.py`** — enums (`Category`, `TestStatus`, `Severity`,
  `DetectionSource`) y dataclasses (`Scenario`, `TestResult`, `LabMeta`).
- **`scenarios.py`** — catálogo de 17 escenarios (datos, no código de ataque).
- **`ingest.py`** — carga y normaliza el log JSON del harness.
- **`evaluator.py`** — convierte registros en PASS/FAIL/INCONCLUSIVE/PENDING,
  aplica la guarda de honestidad sobre Hyperion y calcula el riesgo.
- **`registry.py`** — `Lab`: une escenarios + resultados y produce estadísticas.
- **`reporting/`** — generadores JSON, CSV y HTML.
- **`cli.py`** — interfaz de línea de comandos (también la base de los tests).

### GUI (`redteamlab/gui/`)
Capa fina sobre el núcleo. Sin lógica de negocio propia: lee del `Lab`. Por eso
toda la lógica está cubierta por tests aunque la GUI no se ejecute en CI.

### Roblox (`RobloxModules/src/`)
- **Puro** (testeable fuera de Roblox): `RTL_Schema`, `RTL_MovementValidator`,
  `RTL_RateLimiter`, `RTL_Economy`, `RTL_Permissions`, `RTL_RiskScore`,
  `RTL_Logger`, `RTL_Telemetry`.
- **Integración** (requiere Studio): `RTL_Bootstrap.server`, `RTL_SelfTest.server`,
  `RTL_TestHarness.client`.

## Decisiones clave

- **Un único origen de verdad para los escenarios** (`scenarios.py`) consumido
  por CLI, GUI e informes.
- **Lógica Luau pura y sin tipos** para poder ejecutarla con un runtime Lua
  estándar (lupa) y con el Luau CLI, usando el **mismo** spec de tests.
- **Honestidad codificada**: la degradación de `HYPERION`→`UNKNOWN` sin evidencia
  está implementada y testeada en Python *y* en Luau.
- **PENDING ≠ PASS**: un escenario sin resultado nunca se cuenta como superado.
