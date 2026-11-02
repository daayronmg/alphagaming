# Informe de limitaciones y honestidad técnica

Este documento es parte obligatoria de la entrega. Describe qué se puede y qué
**no** se puede concluir con esta herramienta, y qué se ejecutó realmente.

## 1. Qué NO hace esta herramienta (por diseño)

- **No** inyecta DLLs ni código en el proceso de Roblox.
- **No** lee ni modifica la memoria del cliente de Roblox.
- **No** oculta modificaciones ni intenta evadir detección.
- **No** desactiva, parchea ni "supera" Hyperion.
- La aplicación de escritorio **no interactúa con el cliente de Roblox** en
  absoluto. Es un gestor de casos de prueba e informes.

Estas exclusiones son intencionadas y coinciden con el encargo. Son, además, la
ingeniería correcta: el cliente es no confiable, de modo que la seguridad se
demuestra haciendo que **el servidor** rechace la manipulación.

## 2. El nivel "Hyperion": limitación y método legítimo

**Dato/acceso que falta:** Hyperion es un componente anti-trampa propietario de
Roblox cuyo funcionamiento interno no es público ni accesible. No existe una
interfaz autorizada que exponga, de forma verificable para un tercero, si
Hyperion detectó o bloqueó un comportamiento concreto.

**Qué SÍ se puede comprobar sin ese acceso:**
- Que tu experiencia detecta y rechaza comportamientos anómalos del lado del
  servidor (movimiento imposible, argumentos inválidos, abuso de economía,
  acciones sin permiso), que es lo que realmente protege tu juego.
- Que el servidor es la autoridad y no confía en valores del cliente.

**Qué método autorizado completaría una evaluación de Hyperion:**
- Canales oficiales de Roblox (p. ej. programas de seguridad / divulgación
  responsable de Roblox) y la telemetría/paneles que Roblox exponga al creador.
- Observación empírica *dentro de tu experiencia*: si el cliente de un
  comportamiento manipulado es desconectado por el sistema de la plataforma (no
  por tu código), regístralo con la evidencia disponible — pero **no** se
  atribuye a Hyperion salvo evidencia verificable.

**Qué NO se puede concluir:** que Hyperion ha sido evadido, superado o
desactivado. Esta herramienta nunca emite esa afirmación. El evaluador degrada
automáticamente cualquier `detection_source = HYPERION` sin evidencia a
`UNKNOWN` (ver `evaluator.py` y `RTL_Logger.lua`, ambos con test que lo cubre).

## 3. Qué se ejecutó realmente en el entorno de desarrollo

El entorno de desarrollo era Linux (sin Windows, sin .NET, sin Luau CLI).

| Componente | Acción | Resultado |
| :-- | :-- | :-- |
| Núcleo Python (`redteamlab`) | `python3 -m unittest` (33 tests) | **Ejecutado, 33/33 OK** |
| CLI `demo` (genera JSON/CSV/HTML) | Ejecutado | **OK, informes generados en `Reports/`** |
| Lógica pura Luau (`rtl_spec.lua`) | Ejecutada vía `lupa` (30 tests) | **Ejecutado, 30/30 OK** |
| GUI PySide6 | **Ejecutada (smoke test headless)** | Con PySide6 6.12 y `QT_QPA_PLATFORM=offscreen`: la ventana completa se construye, el dashboard se actualiza al importar (12 PASS / 2 FAIL / 1 INCONCLUSIVE / 2 PENDING), cada módulo rellena su tabla y la exportación funciona. Capturas en `Reports/screenshots/`. En un PC con pantalla se abre con `python run_gui.py`. |
| `RobloxRedTeamLab.exe` | **No compilado** | PyInstaller compila por-SO; un .exe de Windows no se puede producir desde Linux. Receta reproducible en `build_exe.ps1`. |
| Scripts de integración Roblox (`RTL_Bootstrap`, `RTL_SelfTest`, `RTL_TestHarness`) | **No ejecutados** | Requieren Roblox Studio (usan servicios de Roblox). Verificados por revisión; la lógica pura que invocan sí está testeada. |

No se marca como superado nada que no se haya ejecutado. Las casillas "No
ejecutado/compilado" indican exactamente qué falta y por qué, y cómo
completarlo (Windows + Qt para la GUI/exe; Roblox Studio para la integración).

## 4. Validez de los datos de ejemplo

`WindowsApp/sample_data/sample_results.json` contiene valores **ilustrativos**
para poblar la interfaz y los informes de demostración. No son medidas de ningún
sistema en vivo. Los resultados reales provienen de ejecutar `RTL_SelfTest` en tu
propia experiencia e importar su log.
