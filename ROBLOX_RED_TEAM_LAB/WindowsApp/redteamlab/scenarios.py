"""Built-in catalog of security test scenarios.

These are *definitions* (what to test and what a secure server should do), not
attack implementations. They map one-to-one onto the Movement / RemoteEvent /
Economy / Permissions modules described in the spec. The Luau self-test harness
(RobloxModules) is what actually exercises the operator's own server using
these definitions; this catalog is the shared source of truth consumed by the
CLI, GUI and reports.
"""
from __future__ import annotations

from .models import Category, Scenario, Severity


def _s(**kw) -> Scenario:
    return Scenario(**kw)


def builtin_scenarios() -> list[Scenario]:
    return [
        # ---------------- MOVEMENT ----------------
        _s(
            id="MOV-001", name="Speed hack (excessive walk speed)", category=Category.MOVEMENT,
            description="Client reports horizontal displacement implying a speed above the allowed maximum.",
            objective="Verify the server rejects or clamps movement that exceeds the configured max speed.",
            initial_conditions="Player spawned on a flat baseplate; server max speed configured.",
            procedure="Harness fires movement updates whose delta implies speed > maxSpeed for several ticks.",
            expected_result="Server rejects/corrects position (snapback) and flags the anomaly; no speed advantage persists.",
            severity_if_failed=Severity.HIGH,
            params={"max_speed_studs_s": 24, "injected_speed_studs_s": 180},
        ),
        _s(
            id="MOV-002", name="Teleport (impossible displacement)", category=Category.MOVEMENT,
            description="Position jumps a large distance within a single tick (no path, no dt to justify it).",
            objective="Verify the server detects an impossible single-tick displacement and rejects it.",
            initial_conditions="Player at a known position; server tracks last authoritative position and time.",
            procedure="Harness sets a new position far from the last authoritative one within one tick.",
            expected_result="Server rejects the teleport and restores the last valid position; anomaly logged.",
            severity_if_failed=Severity.HIGH,
            params={"max_speed_studs_s": 24, "jump_distance_studs": 500, "dt_s": 0.1},
        ),
        _s(
            id="MOV-003", name="Fly (sustained unsupported altitude)", category=Category.MOVEMENT,
            description="Vertical position stays elevated with no supporting part / jump arc.",
            objective="Verify the server detects sustained unsupported altitude.",
            initial_conditions="Player on ground; raycast-based ground check available server-side.",
            procedure="Harness reports elevated Y for longer than a normal jump could sustain.",
            expected_result="Server flags sustained unsupported altitude and corrects/denies the state.",
            severity_if_failed=Severity.MEDIUM,
            params={"max_air_time_s": 1.5, "injected_air_time_s": 8.0},
        ),
        _s(
            id="MOV-004", name="Noclip (movement through collision)", category=Category.MOVEMENT,
            description="Position crosses a solid boundary the server knows about.",
            objective="Verify the server validates movement against server-side collision/zones.",
            initial_conditions="A server-known solid wall / restricted zone exists.",
            procedure="Harness reports a path that passes through the solid boundary.",
            expected_result="Server rejects the crossing; player cannot occupy the restricted space.",
            severity_if_failed=Severity.MEDIUM,
            params={"zone": "restricted_wall_A"},
        ),
        _s(
            id="MOV-005", name="Infinite jump (repeated jumps while airborne)", category=Category.MOVEMENT,
            description="Jump requested repeatedly without ever touching the ground.",
            objective="Verify jumps are only honored when the server believes the player is grounded.",
            initial_conditions="Server tracks grounded state.",
            procedure="Harness requests jump N times while server-side grounded state is false.",
            expected_result="Server honors at most one jump until grounded again; extra jumps rejected.",
            severity_if_failed=Severity.LOW,
            params={"jumps_requested": 10},
        ),

        # ---------------- REMOTE EVENTS ----------------
        _s(
            id="RMT-001", name="Unexpected argument types", category=Category.REMOTE,
            description="A RemoteEvent is fired with argument types it does not expect.",
            objective="Verify the server validates argument types and rejects malformed calls.",
            initial_conditions="A RemoteEvent with a known expected signature.",
            procedure="Harness fires the remote with wrong types (string where number expected, table, nil...).",
            expected_result="Server rejects the call, logs it, and does not mutate state.",
            severity_if_failed=Severity.MEDIUM,
            params={"remote": "RequestPurchase", "bad_args": ["'abc'", "{}", "nil"]},
        ),
        _s(
            id="RMT-002", name="Out-of-range / extreme / NaN / Inf values", category=Category.REMOTE,
            description="Numeric arguments are negative, extreme, NaN or Infinity.",
            objective="Verify the server range-checks numbers and rejects NaN/Inf/negative where invalid.",
            initial_conditions="A RemoteEvent accepting a bounded numeric argument.",
            procedure="Harness sends -1, 1e308, NaN, math.huge for a quantity that must be a small positive int.",
            expected_result="Server rejects every invalid value; no state change.",
            severity_if_failed=Severity.HIGH,
            params={"remote": "SetQuantity", "values": [-1, 1e308, "NaN", "Inf"]},
        ),
        _s(
            id="RMT-003", name="Excessive call frequency (rate limit)", category=Category.REMOTE,
            description="A RemoteEvent is fired far faster than any legitimate client would.",
            objective="Verify server-side per-player rate limiting throttles/denies floods.",
            initial_conditions="Rate limiter configured for the remote.",
            procedure="Harness fires the remote N times within a short window.",
            expected_result="Calls beyond the limit are dropped/denied and logged; server stays responsive.",
            severity_if_failed=Severity.MEDIUM,
            params={"remote": "ClaimReward", "calls": 200, "window_s": 1.0, "limit": 5},
        ),
        _s(
            id="RMT-004", name="Client-authoritative field mutation attempt", category=Category.REMOTE,
            description="Client tries to set a value only the server should own (e.g. its own balance).",
            objective="Verify the server ignores client-supplied values for server-owned state.",
            initial_conditions="Server owns the authoritative balance/stat.",
            procedure="Harness fires a remote carrying a desired balance value.",
            expected_result="Server ignores the client value and derives state itself; attempt logged.",
            severity_if_failed=Severity.CRITICAL,
            params={"remote": "SyncStats", "claimed": {"coins": 999999}},
        ),

        # ---------------- ECONOMY ----------------
        _s(
            id="ECO-001", name="Unauthorized coin alteration", category=Category.ECONOMY,
            description="Attempt to increase currency without a valid, server-verified transaction.",
            objective="Verify currency only changes through server-validated transactions.",
            initial_conditions="Player has a known server-held balance.",
            procedure="Harness requests a balance increase with no backing purchase/reward.",
            expected_result="Server denies the change; balance unchanged; attempt logged.",
            severity_if_failed=Severity.CRITICAL,
            params={"delta": 100000},
        ),
        _s(
            id="ECO-002", name="Negative amount transaction", category=Category.ECONOMY,
            description="A transaction with a negative quantity/price.",
            objective="Verify the server rejects negative amounts (no refund/drain exploits).",
            initial_conditions="A purchase/transfer remote exists.",
            procedure="Harness submits a transaction with amount < 0.",
            expected_result="Server rejects it; no balance movement.",
            severity_if_failed=Severity.HIGH,
            params={"amount": -500},
        ),
        _s(
            id="ECO-003", name="Duplicate / replayed reward claim", category=Category.ECONOMY,
            description="The same one-time reward claim is submitted twice.",
            objective="Verify reward grants are idempotent (server-tracked, single-grant).",
            initial_conditions="A one-time reward the player has already claimed.",
            procedure="Harness replays the claim request.",
            expected_result="Second claim is denied; reward granted exactly once.",
            severity_if_failed=Severity.HIGH,
            params={"reward_id": "daily_bonus", "replays": 5},
        ),
        _s(
            id="ECO-004", name="Repeated purchase race (double-spend)", category=Category.ECONOMY,
            description="Many purchase requests fired concurrently to try to spend the same funds twice.",
            objective="Verify the server serializes/locks balance mutations.",
            initial_conditions="Balance only sufficient for one purchase.",
            procedure="Harness fires several concurrent purchase requests.",
            expected_result="At most one purchase succeeds; balance never goes negative.",
            severity_if_failed=Severity.HIGH,
            params={"concurrent": 20, "price": 100},
        ),
        _s(
            id="ECO-005", name="Inventory manipulation (grant unowned item)", category=Category.ECONOMY,
            description="Attempt to add an item the player never legitimately obtained.",
            objective="Verify inventory additions require a server-validated source.",
            initial_conditions="Server-held inventory.",
            procedure="Harness requests adding an item id with no valid acquisition.",
            expected_result="Server denies the addition; inventory unchanged.",
            severity_if_failed=Severity.HIGH,
            params={"item_id": "legendary_sword", "qty": 99},
        ),

        # ---------------- PERMISSIONS ----------------
        _s(
            id="PRM-001", name="Non-admin invokes admin action", category=Category.PERMISSIONS,
            description="A player without the admin role calls an admin-only remote.",
            objective="Verify the server checks role before executing privileged actions.",
            initial_conditions="Caller has no admin role server-side.",
            procedure="Harness invokes an admin remote as a normal player.",
            expected_result="Server denies the action and logs the attempt.",
            severity_if_failed=Severity.CRITICAL,
            params={"remote": "KickPlayer"},
        ),
        _s(
            id="PRM-002", name="Restricted function from unauthorized context", category=Category.PERMISSIONS,
            description="A restricted function is invoked from a context not allowed to call it.",
            objective="Verify restricted functions validate the caller/context, not just presence.",
            initial_conditions="A function restricted to a specific role/context.",
            procedure="Harness invokes it from an unauthorized context.",
            expected_result="Server denies execution.",
            severity_if_failed=Severity.HIGH,
            params={"remote": "GrantRole"},
        ),
        _s(
            id="PRM-003", name="Privilege escalation via role self-assignment", category=Category.PERMISSIONS,
            description="A player attempts to assign themselves a higher role.",
            objective="Verify role assignment is server-controlled and not client-driven.",
            initial_conditions="Role data owned by the server.",
            procedure="Harness requests assigning itself the admin role.",
            expected_result="Server denies; role unchanged; attempt logged.",
            severity_if_failed=Severity.CRITICAL,
            params={"target_role": "admin"},
        ),
    ]


def scenarios_by_id() -> dict[str, Scenario]:
    return {s.id: s for s in builtin_scenarios()}


def scenarios_in(category: Category) -> list[Scenario]:
    return [s for s in builtin_scenarios() if s.category is category]
