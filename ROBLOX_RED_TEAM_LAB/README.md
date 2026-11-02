# ROBLOX RED TEAM LAB

Centro de control para **auditoría de seguridad autorizada** de una experiencia
Roblox **propia**. La herramienta organiza, ejecuta (vía un harness dentro de tu
propia experiencia), registra y evalúa pruebas de seguridad, y genera informes
en JSON, CSV y HTML.

> **Alcance y honestidad técnica.** Esta herramienta **no** inyecta DLLs, **no**
> manipula la memoria del proceso Roblox, **no** oculta modificaciones y **no**
> intenta evadir ni desactivar Hyperion. La aplicación de escritorio **no toca
> el cliente de Roblox**: es un gestor de pruebas e informes. La comprobación
> real ("¿el servidor rechaza la acción manipulada?") ocurre dentro de tu propia
> experiencia autorizada mediante validadores server-side. Consulta
> [`Documentation/LIMITATIONS.md`](Documentation/LIMITATIONS.md).

## Qué hay aquí

```
ROBLOX_RED_TEAM_LAB/
├── WindowsApp/          App de escritorio (Python + PySide6) y CLI headless
│   ├── redteamlab/      Núcleo testeable (modelos, escenarios, evaluación, informes) + GUI
│   ├── sample_data/     Log de resultados de ejemplo para poblar la UI/informes
│   ├── run_cli.py       Entrada headless (funciona en cualquier SO)
│   ├── run_gui.py       Entrada GUI (PySide6)
│   ├── build_exe.ps1    Script de compilación del .exe (Windows 10 x64)
│   └── redteamlab.spec  Especificación PyInstaller
├── RobloxModules/       Componentes Luau para tu experiencia propia
│   ├── src/             Validadores server-side + harness + arranque
│   └── tests/           Tests de la lógica pura (Luau CLI y runner lupa)
├── Tests/               Tests unitarios Python (stdlib unittest)
├── Reports/             Salida de informes generados
├── Documentation/       Instalación, uso, arquitectura, límites, setup Roblox
└── README.md
```

## Tres niveles de prueba (y qué prueba cada uno)

1. **Lógica y seguridad dentro de tu experiencia Roblox propia** — validadores
   server-side (movimiento, RemoteEvents, economía, permisos) y su harness de
   auto-prueba. *Esto es lo que esta herramienta verifica de forma reproducible.*
2. **Simulación controlada de comportamientos asociados a trampas** — el harness
   envía entradas anómalas/mal formadas a *tus propios* RemoteEvents para
   comprobar que el servidor las rechaza. No proporciona ventaja de juego.
3. **Evaluación de la protección del cliente por Hyperion** — **no accesible**
   sin un componente interno autorizado que aquí no existe. Se documenta como
   limitación con un método de validación legítimo; nunca se afirma una evasión.

## Inicio rápido (sin GUI, funciona ya)

```bash
# Genera informes de ejemplo a partir del log incluido
python3 WindowsApp/run_cli.py demo

# Lista los escenarios integrados
python3 WindowsApp/run_cli.py list-scenarios

# Ingesta tu propio log de resultados y genera informes
python3 WindowsApp/run_cli.py import --results ruta/al/log.json --out Reports
```

## Pruebas

```bash
# Núcleo Python (33 tests, solo stdlib)
python3 -m unittest discover -s Tests -p 'test_*.py'

# Lógica pura Luau vía lupa (30 tests) — mismo spec que el Luau CLI
pip install lupa
python3 RobloxModules/tests/run_with_lupa.py

# Lógica pura Luau en el CLI oficial de Luau (para devs de Roblox)
luau RobloxModules/tests/run_luau_tests.lua
```

## GUI y ejecutable

- `pip install -r WindowsApp/requirements.txt` instala PySide6.
- `python WindowsApp/run_gui.py` abre la interfaz oscura.
- `WindowsApp/build_exe.ps1` compila `RobloxRedTeamLab.exe` en **Windows 10 x64**.

Consulta [`Documentation/INSTALL.md`](Documentation/INSTALL.md) y
[`Documentation/USAGE.md`](Documentation/USAGE.md).

## Estado de verificación

Lo ejecutado y comprobado en el entorno de desarrollo está documentado en
[`Documentation/LIMITATIONS.md`](Documentation/LIMITATIONS.md). No se inventan
resultados: una prueba sin ejecución figura como `PENDING`; ejecutar código no
equivale a `PASS`.
