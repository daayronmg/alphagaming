#!/usr/bin/env python3
"""Run the shared Luau spec (rtl_spec.lua) against the pure RTL_* modules using
a standard Lua runtime via the `lupa` package.

This exists so the pure module logic can be exercised on a machine that has no
Luau CLI (CI / Linux). The authoritative runner for Roblox developers is
run_luau_tests.lua (Luau CLI); both use the SAME rtl_spec.lua assertions.

    pip install lupa
    python RobloxModules/tests/run_with_lupa.py

The pure modules are written as plain Lua (a subset of Luau), so a standard Lua
runtime can load them unchanged.
"""
import sys
from pathlib import Path

try:
    from lupa import LuaRuntime
except ImportError:
    print("lupa is not installed. Run: pip install lupa", file=sys.stderr)
    sys.exit(3)

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "src"

MODULES = {
    "Schema": SRC / "ReplicatedStorage" / "RTL_Schema.lua",
    "Movement": SRC / "ServerScriptService" / "RTL_MovementValidator.lua",
    "RateLimiter": SRC / "ServerScriptService" / "RTL_RateLimiter.lua",
    "Economy": SRC / "ServerScriptService" / "RTL_Economy.lua",
    "Permissions": SRC / "ServerScriptService" / "RTL_Permissions.lua",
    "RiskScore": SRC / "ServerScriptService" / "RTL_RiskScore.lua",
}


def main() -> int:
    lua = LuaRuntime(unpack_returned_tuples=True)
    load = lua.eval("load")

    def load_lua_module(path: Path):
        src = path.read_text(encoding="utf-8")
        result = load(src, "@" + path.name)
        if isinstance(result, tuple):  # (nil, errmsg) -> compile error
            raise SyntaxError(f"{path.name}: {result[1]}")
        if result is None:
            raise SyntaxError(f"{path.name}: failed to load")
        return result()  # execute the chunk -> the module's returned table

    modules = {name: load_lua_module(path) for name, path in MODULES.items()}
    m = lua.table_from(modules)

    spec_fn = load_lua_module(HERE / "rtl_spec.lua")  # rtl_spec returns a function
    passed, failed = spec_fn(m)
    print(f"\n[lupa runner] total: {int(passed)} passed, {int(failed)} failed")
    return 0 if int(failed) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
