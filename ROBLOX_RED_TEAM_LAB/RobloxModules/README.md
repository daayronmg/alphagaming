# RobloxModules

Componentes Luau para una experiencia Roblox **propia y autorizada**. Defienden
tu juego del lado del servidor y permiten auto-probar esas defensas. No
interactúan con Hyperion ni con el cliente de producción.

- **`src/`** — módulos. Ver [`../Documentation/ROBLOX_SETUP.md`](../Documentation/ROBLOX_SETUP.md)
  para dónde colocar cada archivo en el Explorer de Studio.
- **`tests/`** — tests de la lógica pura:
  - `run_luau_tests.lua` — para el [Luau CLI](https://github.com/luau-lang/luau).
  - `run_with_lupa.py` — mismo spec, ejecutable con un runtime Lua estándar
    (`pip install lupa`), útil en CI/Linux.
  - `rtl_spec.lua` — assertions compartidas (única fuente de verdad).

Los módulos puros se escriben como Lua plano (subconjunto de Luau) para poder
testearlos fuera de Roblox sin perder compatibilidad con Studio.

## Patrón server-authoritative

```
cliente (no confiable)
   │  FireServer(args)         ← puede mentir
   ▼
RemoteEvent (tu experiencia)
   ▼  rate-limit  →  validar tipos/rango/finitud  →  permisos  →
      mutar estado SOLO en el servidor  →  registrar en RTL_Logger
```
