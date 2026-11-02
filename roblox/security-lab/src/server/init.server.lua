--!strict
-- SecurityLab / Server bootstrap
-- Guards the harness, exposes oracles ("probes") so attack modules can CONFIRM
-- side-effects server-side, and collects findings into an exportable log.

local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local Config = require(ReplicatedStorage.SecurityLab.Config)
local Protocol = require(ReplicatedStorage.SecurityLab.Protocol)

-- ---- Safety guard ---------------------------------------------------------
local function authorised(): boolean
	if Config.AllowInStudio and RunService:IsStudio() then
		return true
	end
	if Config.TestPlaceId ~= 0 and game.PlaceId == Config.TestPlaceId then
		return true
	end
	if workspace:GetAttribute(Config.LabAttribute) == true then
		return true
	end
	return false
end

if not authorised() then
	warn("[SecurityLab] Not an authorised lab server — harness DISABLED.")
	return
end
warn("[SecurityLab] Authorised lab server. Harness ENABLED. Do NOT ship this build to production.")

local net = Protocol.buildServer()

-- ---- Finding log ----------------------------------------------------------
local log = {}
local function record(finding)
	finding.t = os.time()
	table.insert(log, finding)
	net.Report:FireAllClients(finding)
	return finding
end

-- ---- Probe registry -------------------------------------------------------
-- An oracle that lets an attack module observe real server state, so a result
-- is only ever reported as CONFIRMED when a side-effect is actually measured.
-- A probe is: function(player) -> value
local Probes = {}

-- Built-in movement oracle: current HumanoidRootPart position + server clock.
local function moveSample(player)
	local ch = player.Character
	local hrp = ch and ch:FindFirstChild("HumanoidRootPart")
	if not hrp then
		return nil
	end
	return { pos = hrp.Position, t = os.clock() }
end

-- ---------------------------------------------------------------------------
-- WIRE YOUR OWN PROBES HERE. Examples (uncomment and connect to your data):
--
-- Probes.balance = function(player)
--     return YourEconomy:GetCoins(player.UserId)
-- end
--
-- Probes.inventoryCount = function(player)
--     return YourInventory:Count(player.UserId, "sword")
-- end
-- ---------------------------------------------------------------------------

-- ---- Control endpoint -----------------------------------------------------
net.Control.OnServerInvoke = function(player, req)
	if typeof(req) ~= "table" then
		return { ok = false, err = "bad request" }
	end

	if req.op == "moveSample" then
		return { ok = true, sample = moveSample(player) }
	elseif req.op == "probe" then
		local fn = Probes[req.name]
		if typeof(fn) ~= "function" then
			return { ok = false, err = "no such probe: " .. tostring(req.name) }
		end
		local ok, val = pcall(fn, player)
		return { ok = ok, value = ok and val or nil, err = (not ok) and tostring(val) or nil }
	elseif req.op == "report" then
		if typeof(req.finding) == "table" then
			req.finding.by = player.Name
			record(req.finding)
			return { ok = true }
		end
		return { ok = false, err = "no finding" }
	elseif req.op == "getlog" then
		return { ok = true, log = log }
	elseif req.op == "export" then
		local ok, json = pcall(function()
			return HttpService:JSONEncode(log)
		end)
		return { ok = ok, json = ok and json or nil }
	end

	return { ok = false, err = "unknown op" }
end

do
	local names = {}
	for k in pairs(Probes) do
		table.insert(names, k)
	end
	print("[SecurityLab] Server ready. Registered probes: " .. (next(names) and table.concat(names, ", ") or "(none)"))
end
