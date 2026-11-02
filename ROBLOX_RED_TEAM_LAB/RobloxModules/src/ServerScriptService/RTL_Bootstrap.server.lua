--!strict
-- RTL_Bootstrap: wires the pure validators to real RemoteEvents in YOUR OWN
-- authorized experience. This is the integration layer and runs only inside
-- Roblox Studio / a live server (it references Roblox services). Place this
-- script in ServerScriptService with the sibling RTL_* ModuleScripts.
--
-- It demonstrates the server-authoritative pattern: every critical action is
-- validated server-side; the client is never trusted.

local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local Config = require(ServerScriptService:WaitForChild("RTL_Config"))
local Schema = require(ReplicatedStorage:WaitForChild("RTL_Schema"))
local Movement = require(ServerScriptService:WaitForChild("RTL_MovementValidator"))
local RateLimiter = require(ServerScriptService:WaitForChild("RTL_RateLimiter"))
local Economy = require(ServerScriptService:WaitForChild("RTL_Economy"))
local Permissions = require(ServerScriptService:WaitForChild("RTL_Permissions"))
local Logger = require(ServerScriptService:WaitForChild("RTL_Logger"))

local log = Logger.new()

-- Per-player state owned by the server.
local accounts: {[Player]: any} = {}
local limiters: {[Player]: {[string]: any}} = {}
local roles: {[Player]: string} = {}

local function accountFor(plr: Player)
	if not accounts[plr] then
		accounts[plr] = Economy.new(100) -- starting balance owned by server
	end
	return accounts[plr]
end

local function limiterFor(plr: Player, remoteName: string)
	limiters[plr] = limiters[plr] or {}
	if not limiters[plr][remoteName] then
		limiters[plr][remoteName] = RateLimiter.new(Config.Rate.DefaultLimit, Config.Rate.DefaultWindowSec)
	end
	return limiters[plr][remoteName]
end

Players.PlayerAdded:Connect(function(plr)
	accountFor(plr)
	roles[plr] = "player" -- default role; promotion is server-side only, never client-driven
end)

Players.PlayerRemoving:Connect(function(plr)
	accounts[plr] = nil
	limiters[plr] = nil
	roles[plr] = nil
end)

-- Create (or reuse) the RemoteEvents folder in ReplicatedStorage.
local remotes = ReplicatedStorage:FindFirstChild("RTL_Remotes")
if not remotes then
	remotes = Instance.new("Folder")
	remotes.Name = "RTL_Remotes"
	remotes.Parent = ReplicatedStorage
end

local function ensureRemote(name: string): RemoteEvent
	local r = remotes:FindFirstChild(name)
	if not r then
		r = Instance.new("RemoteEvent")
		r.Name = name
		r.Parent = remotes
	end
	return r :: RemoteEvent
end

-- Example: a quantity-setting remote that must receive a small positive integer.
local setQuantity = ensureRemote("SetQuantity")
setQuantity.OnServerEvent:Connect(function(plr, qty)
	if not limiterFor(plr, "SetQuantity"):allow(os.clock()) then
		log:add({ scenario_id = "RMT-003", server_rejected = true,
			detection_source = "CUSTOM_DETECTOR", observed = "rate limited",
			evidence = { "SetQuantity over limit" } })
		return
	end
	local ok, reason = Schema.validateValue(qty, { type = "number", integer = true, min = 1, max = 999 })
	if not ok then
		log:add({ scenario_id = "RMT-002", server_rejected = true,
			detection_source = "SERVER_REJECT", observed = "invalid qty",
			server_response = "rejected: " .. tostring(reason), evidence = { tostring(reason) } })
		return
	end
	-- ... apply the validated quantity ...
end)

-- Example: an admin-only action.
local kickPlayer = ensureRemote("KickPlayer")
kickPlayer.OnServerEvent:Connect(function(plr, _targetName)
	local ok, reason = Permissions.authorize(Config.Roles, roles[plr] or "player", "admin", "KickPlayer")
	if not ok then
		log:add({ scenario_id = "PRM-001", server_rejected = true,
			detection_source = "SERVER_REJECT", observed = "non-admin KickPlayer attempt",
			server_response = "denied", evidence = { tostring(reason) } })
		return
	end
	-- ... perform the privileged action ...
end)

print("[RTL] Bootstrap ready. RemoteEvents under ReplicatedStorage/RTL_Remotes.")

return { logger = log }
