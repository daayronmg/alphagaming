# Configuración del laboratorio en Roblox Studio

Instala estos módulos **solo en una experiencia propia y autorizada**.

## Colocación de archivos

| Archivo | Ubicación en el Explorer | Tipo |
| :-- | :-- | :-- |
| `RTL_Schema.lua` | `ReplicatedStorage` | ModuleScript |
| `RTL_Config.lua` | `ServerScriptService` | ModuleScript |
| `RTL_MovementValidator.lua` | `ServerScriptService` | ModuleScript |
| `RTL_RateLimiter.lua` | `ServerScriptService` | ModuleScript |
| `RTL_Economy.lua` | `ServerScriptService` | ModuleScript |
| `RTL_Permissions.lua` | `ServerScriptService` | ModuleScript |
| `RTL_Logger.lua` | `ServerScriptService` | ModuleScript |
| `RTL_RiskScore.lua` | `ServerScriptService` | ModuleScript |
| `RTL_Telemetry.lua` | `ServerScriptService` | ModuleScript |
| `RTL_Bootstrap.server.lua` | `ServerScriptService` | Script |
| `Tests/RTL_SelfTest.server.lua` | `ServerScriptService` | Script |
| `RTL_TestHarness.client.lua` | `StarterPlayer > StarterPlayerScripts` | LocalScript |

> Los nombres de los ModuleScripts deben quedar **sin** el sufijo de extensión
> (`RTL_MovementValidator`, etc.) para que `require(... :WaitForChild("RTL_..."))`
> los encuentre.

## Ejecutar el harness

1. Abre tu experiencia en Studio.
2. Pulsa **Run** (no *Play*) para iniciar un servidor.
3. `RTL_SelfTest` se ejecuta al iniciar y escribe en la **Output** un bloque
   JSON entre los marcadores `===== RTL SELF-TEST RESULT LOG =====`.
4. Copia ese JSON a un archivo e **impórtalo** en la app de escritorio.

## Principio de diseño

- **El servidor es la autoridad.** Ningún valor crítico (saldo, rol, posición
  validada, inventario) se acepta del cliente.
- **El cliente es no confiable.** `RTL_TestHarness` solo envía entradas de
  prueba a tus propios RemoteEvents; si el servidor es correcto, todas se
  rechazan y no otorgan ventaja.
- **Nada de evasión.** Estos módulos defienden tu experiencia; no interactúan
  con Hyperion.

## Adaptación a tu juego

`RTL_Bootstrap.server.lua` incluye dos RemoteEvents de ejemplo (`SetQuantity`,
`KickPlayer`). Sustitúyelos/añade los tuyos aplicando el mismo patrón:
rate-limit → validación de esquema/rango → comprobación de permisos →
mutación de estado server-side → registro en `RTL_Logger`.
