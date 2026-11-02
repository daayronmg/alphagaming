# Build the Windows .exe for ROBLOX RED TEAM LAB.
# Run on Windows 10 x64 in this folder (WindowsApp):
#   powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
#
# The .exe CANNOT be produced from Linux/macOS; PyInstaller builds per-OS.
# This script is the reproducible recipe for the Windows build machine.

$ErrorActionPreference = "Stop"

Write-Host "== ROBLOX RED TEAM LAB :: Windows build ==" -ForegroundColor Cyan

# 1. Virtual environment
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1

# 2. Dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# 3. Run the test suite first (fail the build if tests fail)
Push-Location ..
python -m unittest discover -s Tests -p "test_*.py"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Unit tests failed - aborting build." }
Pop-Location

# 4. Package
pyinstaller --noconfirm redteamlab.spec

Write-Host "`nBuild complete. Executable at: dist\RobloxRedTeamLab\RobloxRedTeamLab.exe" -ForegroundColor Green
