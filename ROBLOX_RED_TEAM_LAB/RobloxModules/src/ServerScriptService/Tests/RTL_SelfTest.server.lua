--!strict
-- RTL_SelfTest: server-side harness.
--
-- It feeds known-good and known-bad inputs to the pure validators and records
-- whether the server behaved securely, producing a result log in the exact JSON
-- shape the Windows app ingests. This is how PASS/FAIL/INCONCLUSIVE are
-- *measured*, not assumed: a scenario is PASS only when the server actually
-- rejected the anomalous input.
--
-- Run it inside Studio (Run, not Play). It prints the JSON payload and, if
-- HttpService requests are enabled, can POST/write it. Writing to disk is not
-- possible from Roblox, so copy the printed JSON into a file the app imports,
-- or have the app read it via an HTTP endpoint you control.

local ServerScriptService = game:GetService("ServerScriptService")
local HttpService = game:GetService("HttpService")

local Config = require(ServerScriptService:WaitForChild("RTL_Config"))
local Movement = require(ServerScriptService:WaitForChild("RTL_MovementValidator"))
local Economy = require(ServerScriptService:WaitForChild("RTL_Economy"))
local RateLimiter = require(ServerScriptService:WaitForChild("RTL_RateLimiter"))
local Logger = require(ServerScriptService:WaitForChild("RTL_Logger"))

local RUN_ID = "studio-" .. os.date("!%Y%m%dT%H%M%SZ")
local log = Logger.new()

local function record(scenarioId: string, rejected: boolean, source: string, observed: string, evidence: {string})
	log:add({
		scenario_id = scenarioId,
		run_id = RUN_ID,
		timestamp = os.date("!%Y-%m-%dT%H:%M:%S+00:00"),
		server_rejected = rejected,
		detection_source = source,
		observed = observed,
		evidence = evidence,
	})
end

-- MOV-001 speed hack: injected 180 studs/s over 1s must be rejected.
do
	local secure = not Movement.speedOK(180, 1.0, Config.Movement.MaxSpeedStudsPerSec, Config.Movement.SpeedTolerance)
	record("MOV-001", secure, "SERVER_REJECT",
		"implied speed 180 vs max " .. Config.Movement.MaxSpeedStudsPerSec,
		{ "impliedSpeed=" .. tostring(Movement.impliedSpeed(180, 1.0)) })
end

-- MOV-002 teleport: 500-stud single-tick jump must be rejected.
do
	local secure = not Movement.teleportOK(500, Config.Movement.MaxSingleTickStuds)
	record("MOV-002", secure, "SERVER_REJECT", "500-stud single-tick displacement",
		{ "maxSingleTick=" .. tostring(Config.Movement.MaxSingleTickStuds) })
end

-- MOV-003 fly: 8s unsupported air time must be rejected.
do
	local secure = not Movement.airTimeOK(8.0, Config.Movement.MaxAirTimeSec)
	record("MOV-003", secure, "SERVER_REJECT", "8s air time", { "maxAirTime=" .. tostring(Config.Movement.MaxAirTimeSec) })
end

-- MOV-005 infinite jump: jump while airborne must be rejected.
do
	local secure = not Movement.jumpAllowed(false)
	record("MOV-005", secure, "SERVER_REJECT", "jump requested while airborne", { "grounded=false" })
end

-- RMT-003 rate limit: the 6th call within the window must be denied (limit=5).
do
	local rl = RateLimiter.new(5, 1.0)
	local denied = false
	for i = 1, 6 do
		local allowed = rl:allow(0.0) -- same instant -> same window
		if i == 6 and not allowed then
			denied = true
		end
	end
	record("RMT-003", denied, "CUSTOM_DETECTOR", "6th call within 1s window", { "limit=5" })
end

-- ECO-002 negative amount: must be rejected.
do
	local acc = Economy.new(100)
	local ok = Economy.deposit(acc, -500, Config.Economy.MinTransaction, Config.Economy.MaxTransaction)
	record("ECO-002", not ok, "SERVER_REJECT", "deposit -500", { "amount<min" })
end

-- ECO-003 duplicate reward: second grant must be denied.
do
	local acc = Economy.new(0)
	Economy.grantReward(acc, "daily_bonus", 50, Config.Economy.MinTransaction, Config.Economy.MaxTransaction)
	local second = Economy.grantReward(acc, "daily_bonus", 50, Config.Economy.MinTransaction, Config.Economy.MaxTransaction)
	record("ECO-003", not second, "SERVER_REJECT", "replayed daily_bonus claim", { "grants=1" })
end

-- ECO-005 inventory grant without source: must be rejected.
do
	local acc = Economy.new(0)
	local ok = Economy.addItem(acc, "legendary_sword", 99, nil)
	record("ECO-005", not ok, "SERVER_REJECT", "add item with no source", { "source=nil" })
end

local payload = log:toPayload()
local json = HttpService:JSONEncode(payload)
print("===== RTL SELF-TEST RESULT LOG (import this JSON into the Windows app) =====")
print(json)
print("============================================================================")

return payload
