-- Shared assertions for the pure RTL_* modules.
-- Returns a function run(m) where m = { Schema, Movement, RateLimiter, Economy,
-- Permissions, RiskScore }. run() prints results and returns passed, failed.
-- Used by both run_luau_tests.lua (Luau CLI) and run_with_lupa.py (Lua via lupa),
-- so there is a single source of truth for the test cases.

return function(m)
	local Schema = m.Schema
	local Movement = m.Movement
	local RateLimiter = m.RateLimiter
	local Economy = m.Economy
	local Permissions = m.Permissions
	local RiskScore = m.RiskScore

	local passed, failed = 0, 0
	local function check(name, cond)
		if cond then
			passed = passed + 1
			print("  ok   - " .. name)
		else
			failed = failed + 1
			print("  FAIL - " .. name)
		end
	end

	print("Schema:")
	check("finite rejects NaN", not Schema.isFinite(0 / 0))
	check("finite rejects inf", not Schema.isFinite(math.huge))
	check("finite accepts 1", Schema.isFinite(1))
	check("inRange", Schema.inRange(5, 1, 10) and not Schema.inRange(11, 1, 10))
	check("validateValue rejects wrong type", (Schema.validateValue("x", { type = "number" })) == false)
	check("validateValue rejects negative under min",
		(Schema.validateValue(-1, { type = "number", min = 1, max = 999, integer = true })) == false)
	check("validateArgs arity", (Schema.validateArgs({ 1 }, { { type = "number" }, { type = "number" } })) == false)

	print("Movement:")
	check("speed hack rejected", not Movement.speedOK(180, 1.0, 24, 1.2))
	check("normal speed ok", Movement.speedOK(24, 1.0, 24, 1.2))
	check("zero dt rejected", not Movement.speedOK(1, 0, 24, 1.2))
	check("teleport rejected", not Movement.teleportOK(500, 50))
	check("short hop ok", Movement.teleportOK(10, 50))
	check("fly rejected", not Movement.airTimeOK(8.0, 1.5))
	check("normal airtime ok", Movement.airTimeOK(1.0, 1.5))
	check("jump while airborne rejected", not Movement.jumpAllowed(false))
	check("grounded jump allowed", Movement.jumpAllowed(true))

	print("RateLimiter:")
	do
		local rl = RateLimiter.new(5, 1.0)
		local allowedCount = 0
		for _ = 1, 6 do
			if rl:allow(0.0) then allowedCount = allowedCount + 1 end
		end
		check("limit enforced (5 of 6)", allowedCount == 5)
	end
	do
		local rl = RateLimiter.new(1, 1.0)
		local a = rl:allow(0.0)
		local b = rl:allow(2.0) -- outside window
		check("window resets", a and b)
	end

	print("Economy:")
	do
		local acc = Economy.new(0)
		check("negative deposit rejected", (Economy.deposit(acc, -5, 1, 1000)) == false)
	end
	do
		local acc = Economy.new(10)
		local ok = Economy.withdraw(acc, 50, 1, 1000)
		check("overspend rejected", ok == false and acc.balance == 10)
	end
	do
		local acc = Economy.new(0)
		Economy.grantReward(acc, "r1", 10, 1, 1000)
		local second = Economy.grantReward(acc, "r1", 10, 1, 1000)
		check("reward idempotent", second == false and acc.balance == 10)
	end
	do
		local acc = Economy.new(0)
		check("item needs source", (Economy.addItem(acc, "sword", 1, nil)) == false)
		check("item with source ok", (Economy.addItem(acc, "sword", 1, "quest_reward")) == true)
	end

	print("Permissions:")
	local ranks = { player = 0, moderator = 50, admin = 100 }
	check("player cannot admin", not Permissions.hasAtLeast(ranks, "player", "admin"))
	check("admin can admin", Permissions.hasAtLeast(ranks, "admin", "admin"))
	check("unknown role denied", not Permissions.hasAtLeast(ranks, "ghost", "player"))

	print("RiskScore:")
	check("fail critical scores 100", RiskScore.score({ { status = "FAIL", severity = "CRITICAL" } }) == 100)
	check("all pass scores 0", RiskScore.score({ { status = "PASS", severity = "INFO" } }) == 0)
	check("inconclusive adds 10", RiskScore.score({ { status = "INCONCLUSIVE", severity = "INFO" } }) == 10)
	check("capped at 100", RiskScore.score({
		{ status = "FAIL", severity = "CRITICAL" },
		{ status = "FAIL", severity = "HIGH" },
	}) == 100)

	print(string.format("\n%d passed, %d failed", passed, failed))
	return passed, failed
end
