--!nocheck
-- Entry point for the Luau CLI (https://github.com/luau-lang/luau):
--     luau RobloxModules/tests/run_luau_tests.lua
--
-- It requires the pure modules and runs the shared spec (rtl_spec.lua).
-- Covers only the PURE modules; the Roblox integration scripts require Studio.

local spec = require("./rtl_spec")

local m = {
	Schema = require("../src/ReplicatedStorage/RTL_Schema"),
	Movement = require("../src/ServerScriptService/RTL_MovementValidator"),
	RateLimiter = require("../src/ServerScriptService/RTL_RateLimiter"),
	Economy = require("../src/ServerScriptService/RTL_Economy"),
	Permissions = require("../src/ServerScriptService/RTL_Permissions"),
	RiskScore = require("../src/ServerScriptService/RTL_RiskScore"),
}

local passed, failed = spec(m)
if failed > 0 then
	error(string.format("Luau tests failed: %d failing", failed))
end
