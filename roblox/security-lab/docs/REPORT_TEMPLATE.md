# Vulnerability report — template

One entry per confirmed or suspected finding. Fill from the JSON the panel
exports. Do not mark a finding **Confirmed** unless a probe or observed
side-effect reproduced it — a sent payload is not a confirmed bug.

---

## [ID] Short title

| Field | Value |
| --- | --- |
| **Severity** | Critical / High / Medium / Low / Info |
| **Status** | Confirmed / Inconclusive / Blocked (defended) |
| **Module** | e.g. Economy / Param Tamper |
| **Remote(s)** | e.g. `BuyItem` (RemoteFunction) |
| **Date** | YYYY-MM-DD |

### Vulnerability
What the weakness is, in one or two sentences.

### Impact
What an attacker gains (free currency, item duplication, admin action,
movement advantage). Who/what it affects.

### Reproduction
Exact steps, as run by the harness:
1. Enable the lab in Studio (Play Solo / Start Server + Player).
2. Run module `<name>`.
3. Payload sent: `<remote>(<args>)`.
4. Probe `<name>` before = `<X>`, after = `<Y>`.

### Expected result (secure)
What a correctly defended server should do (reject input, clamp value,
no state change, kick/log).

### Observed result
What actually happened (state changed, value accepted, no throttle).

### Fix
Concrete remediation:
- Validate type and range of every argument server-side.
- Never trust client-supplied prices/quantities — look them up on the server.
- Make reward/claim operations idempotent (dedupe by day/token).
- Clamp movement server-side (max speed, max per-tick displacement).
- Gate privileged remotes behind a server-side role check.

### Re-test after patch
Re-run the same module. Expect **Status: Blocked (defended)**.
