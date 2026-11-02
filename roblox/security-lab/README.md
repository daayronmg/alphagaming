# SecurityLab — in-Studio security test harness for Roblox

A modular harness for auditing **your own** Roblox experience from inside Roblox
Studio. It reproduces how a modified client behaves — firing your RemoteEvents /
RemoteFunctions with malformed data, spamming calls, and manipulating its own
character — and measures whether your **server-side** validation holds.

It runs entirely inside the Roblox sandbox. There is **no external executor, no
injection, no client-integrity bypass, and nothing that can touch a game you do
not own.** A modified client's power over the server is limited to the remotes
and the network-owned character it already controls, and that is exactly the
threat model this harness exercises — legitimately, with normal Luau APIs.

## Why this is the right tool

An attacker does not have secret powers over your server; they have a client
that lies. Every server-authoritative defense you write has to survive a client
that sends garbage. This harness *is* that lying client, under your control, so
you can prove each defense works and re-prove it after every patch.

## What it is NOT

- Not a cheat/exploit you can point at other people's games.
- Not a memory editor or DLL injector.
- Not a vulnerability oracle that guesses: it reports a finding as
  **Confirmed** only when a probe or observed side-effect reproduces it.
  Everything else is **Inconclusive** or **Blocked (defended)**.

## Architecture

```
roblox/security-lab/
├── default.project.json          # Rojo mapping
├── README.md
├── docs/REPORT_TEMPLATE.md       # vuln / impact / repro / expected / fix
└── src/
    ├── shared/   (→ ReplicatedStorage.SecurityLab)
    │   ├── Config.lua             # ★ edit: targets, remote paths, payloads, guard
    │   └── Protocol.lua           # the lab's own internal remotes
    ├── server/   (→ ServerScriptService.SecurityLab)
    │   └── init.server.lua        # guard + probe registry + finding log + export
    └── client/   (→ StarterPlayerScripts.SecurityLab)
        ├── init.client.lua        # builds ctx, loads modules, wires the panel
        ├── Panel.lua              # GUI: module list, live log, JSON export
        └── AttackModules/
            ├── RemoteFuzzer.lua       # 1. malformed args at every remote
            ├── EconomyTamper.lua      # 2. negative qty / client price / double-claim
            ├── RateLimitFlood.lua     # 3. burst / cooldown bypass
            ├── MovementExploit.lua    # 4. speed / teleport vs server oracle
            └── PermissionProbe.lua    # 5. privileged remotes as non-admin
```

### The oracle principle (how it avoids inventing results)

A `LocalScript` can *send* anything, but it cannot see server state. So the
server exposes **probes** — small read-only functions you register
(`Probes.balance`, `Probes.inventoryCount`, `Probes.actionCount`) plus a
built-in movement sampler. An attack module reads a probe **before** and
**after** its payload and only reports `CONFIRMED` when the state actually
changed. No probe → the finding stays `INCONCLUSIVE`, and the panel says so.

## Install (Rojo)

1. Install [Rojo](https://rojo.space/) (CLI + Studio plugin).
2. From this folder, serve it:
   ```bash
   rojo serve
   ```
3. In Studio, open your **test place** (a copy of your game — never production),
   open the Rojo plugin, and **Connect**. The tree syncs into
   ReplicatedStorage / ServerScriptService / StarterPlayerScripts.

No Rojo? Create the three `SecurityLab` containers by hand and paste each file
into a matching `ModuleScript` / `Script` / `LocalScript`.

## Configure (`src/shared/Config.lua`)

1. **Guard** — leave `AllowInStudio = true`. Set `TestPlaceId` to your test
   place if you also run there. The server refuses to start anywhere else.
2. **RemotesParent** — path segments to your remotes folder under
   ReplicatedStorage (e.g. `{ "Remotes" }`).
3. **Targets** — list each remote you want fuzzed: `name`, `kind`
   (`"Event"`/`"Function"`).
4. **Probes** — in `src/server/init.server.lua`, register oracles for the state
   you care about (balance, inventory, action counter). This is what turns
   "sent" into "confirmed".
5. Adjust remote names/arg shapes in `EconomyTamper.lua` and `PermissionProbe.lua`
   to match your API.

## Run

1. Press **Play** (or **Start Server + 1 Player**) in your test place.
2. The 🛡 **SECURITY LAB** panel appears top-right.
3. Click a module to run it. Findings stream into the log, colour-coded by
   severity. The counter tracks totals.
4. Click **Export JSON report**, copy from the dialog or the Output window, and
   fill in `docs/REPORT_TEMPLATE.md` per finding.

## Severity

| Level | Meaning |
| --- | --- |
| 🔴 Critical | Confirmed exploit with direct impact (economy, duplication, admin). |
| 🟠 High | Confirmed weakness (abnormal speed/teleport accepted server-side). |
| 🟡 Medium | Suspicious — server accepted malformed input; needs review. |
| 🟢 Low | Defense held (input rejected / value clamped). |
| 🔵 Info | Sent / inconclusive — no observable signal yet. |

## Extending it

Add a `ModuleScript` to `AttackModules/` returning
`{ name = "...", order = 60, run = function(ctx) ... end }`. `ctx` gives you
`fireEvent`, `invokeFunction`, `probe`, `moveSample`, `report`, `sleep`,
`remotes`, `config`. It is auto-discovered and gets a panel button.

## Scope and ethics

Use only on experiences you own or are explicitly authorised to test, in Studio
or a dedicated test place. Keep the `SecurityLab` containers out of production
builds — the server guard is a safety net, not a licence to ship it.
