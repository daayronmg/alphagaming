--!strict
-- RTL_TestHarness (client): test instrumentation for YOUR OWN test place.
--
-- Its only job is to send deliberately malformed / out-of-range / over-frequency
-- payloads to your OWN experience's RemoteEvents so the server-side validators
-- can be observed rejecting them. It does NOT modify the Roblox client, memory,
-- or Hyperion, and it provides no gameplay advantage: if the server is correct,
-- every call here is rejected. Use it only in a place you own and control.
--
-- Place in StarterPlayer > StarterPlayerScripts. Trigger it manually (e.g. from
-- a dev-only button) rather than on every join.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local function remotes()
	return ReplicatedStorage:WaitForChild("RTL_Remotes")
end

local Harness = {}

-- RMT-002: fire SetQuantity with invalid values; a correct server rejects them.
function Harness.sendInvalidQuantities()
	local setQuantity = remotes():WaitForChild("SetQuantity") :: RemoteEvent
	for _, bad in ipairs({ -1, 1e308, 0, 10000, "abc" }) do
		setQuantity:FireServer(bad)
	end
end

-- RMT-003: fire ClaimReward rapidly to exercise the server rate limiter.
function Harness.floodCalls()
	local setQuantity = remotes():WaitForChild("SetQuantity") :: RemoteEvent
	for _ = 1, 200 do
		setQuantity:FireServer(1)
	end
end

-- PRM-001: as a normal player, attempt an admin-only action; expect denial.
function Harness.attemptAdminAction()
	local kick = remotes():WaitForChild("KickPlayer") :: RemoteEvent
	kick:FireServer("SomePlayer")
end

print("[RTL] Client test harness loaded. Call Harness.* from a dev-only trigger in your own place.")

return Harness
