# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for ROBLOX RED TEAM LAB (build on Windows 10 x64).
#   pip install -r requirements.txt pyinstaller
#   pyinstaller redteamlab.spec
# Output: dist/RobloxRedTeamLab/RobloxRedTeamLab.exe

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

a = Analysis(
    ['run_gui.py'],
    pathex=['.'],
    binaries=[],
    datas=[('sample_data/sample_results.json', 'sample_data')],
    hiddenimports=collect_submodules('redteamlab'),
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='RobloxRedTeamLab',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,   # GUI app; no console window
)
coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False, upx=True, upx_exclude=[],
    name='RobloxRedTeamLab',
)
