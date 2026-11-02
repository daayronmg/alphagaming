@echo off
REM Compila ROBLOX RED TEAM LAB en Windows 10 x64 con doble clic.
REM Requiere Python 3.10+ en el PATH (instalalo desde python.org marcando
REM "Add Python to PATH"). Ejecuta los tests antes de compilar.

setlocal
cd /d "%~dp0"

echo == ROBLOX RED TEAM LAB :: compilacion Windows ==

if not exist ".venv" (
    python -m venv .venv || goto :error
)
call .venv\Scripts\activate.bat || goto :error

python -m pip install --upgrade pip || goto :error
pip install -r requirements.txt || goto :error
pip install pyinstaller || goto :error

echo.
echo -- Ejecutando tests --
pushd ..
python -m unittest discover -s Tests -p "test_*.py" || (popd & goto :error)
popd

echo.
echo -- Compilando --
pyinstaller --noconfirm redteamlab.spec || goto :error

echo.
echo Compilacion correcta.
echo Ejecutable: dist\RobloxRedTeamLab\RobloxRedTeamLab.exe
pause
exit /b 0

:error
echo.
echo ERROR durante la compilacion. Revisa los mensajes anteriores.
pause
exit /b 1
