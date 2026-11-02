# Instalación

## Requisitos

- **Python 3.10+** (desarrollado y probado con 3.13).
- Para la **GUI**: PySide6 (`pip install -r WindowsApp/requirements.txt`).
- Para **compilar el .exe**: Windows 10 x64 + PyInstaller.
- Para los **tests Luau fuera de Roblox**: `pip install lupa`, o el
  [Luau CLI](https://github.com/luau-lang/luau).
- Para la **integración Roblox**: Roblox Studio.

El núcleo y la CLI **no requieren dependencias externas** (solo la librería
estándar de Python).

## Pasos

```bash
git clone <este-repositorio>
cd ROBLOX_RED_TEAM_LAB

# 1) Verifica el núcleo sin instalar nada
python3 WindowsApp/run_cli.py demo
python3 -m unittest discover -s Tests -p 'test_*.py'

# 2) (Opcional) GUI
python3 -m venv .venv && source .venv/bin/activate   # en Windows: .venv\Scripts\activate
pip install -r WindowsApp/requirements.txt
python WindowsApp/run_gui.py

# 3) (Opcional) Tests de la lógica Luau sin Roblox
pip install lupa
python3 RobloxModules/tests/run_with_lupa.py
```

## Compilar el ejecutable Windows

En **Windows 10 x64**, dentro de `WindowsApp/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

Genera `WindowsApp/dist/RobloxRedTeamLab/RobloxRedTeamLab.exe`. El script
ejecuta primero la batería de tests y aborta la compilación si fallan.

> El `.exe` **debe** compilarse en Windows: PyInstaller produce binarios por
> sistema operativo y no permite compilación cruzada desde Linux/macOS.
