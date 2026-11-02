--!strict
-- Module 1 — Remote Fuzzer
-- Sends every malformed payload at each configured target. For RemoteFunctions
-- it can read the return directly; for RemoteEvents the result is INCONCLUSIVE
-- unless a probe confirms a side-effect. It never claims a bug it cannot see.

local RS = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local Config = require(RS.SecurityLab.Config)

local M = { name = "Remote Fuzzer", order = 10 }

local function safe(v): string
	if typeof(v) == "table" then
		local ok, j = pcall(function()
			return HttpService:JSONEncode(v)
		end)
		return ok and j or "<table>"
	end
	return tostring(v)
end

function M.run(ctx)
	if #Config.Targets == 0 then
		ctx.report({
			module = M.name,
			severity = "info",
			title = "No targets configured",
			detail = "Add your RemoteEvents/RemoteFunctions to Config.Targets.",
		})
		return
	end

	for _, tgt in ipairs(Config.Targets) do
		for _, p in ipairs(Config.payloads) do
			local missing = (p.v == Config.MISSING)

			if tgt.kind == "Function" then
				local ok, res
				if missing then
					ok, res = ctx.invokeFunction(tgt.name)
				else
					ok, res = ctx.invokeFunction(tgt.name, p.v)
				end
				if not ok then
					ctx.report({
						module = M.name,
						severity = "low",
						title = ("%s rejected [%s]"):format(tgt.name, p.label),
						detail = "Server aborted on malformed input (good): " .. safe(res),
					})
				else
					ctx.report({
						module = M.name,
						severity = "medium",
						title = ("%s ACCEPTED [%s] — review"):format(tgt.name, p.label),
						detail = "Returned " .. safe(res)
							.. ". Not proof of a bug — confirm this input is validated, not silently processed.",
					})
				end
			else
				if missing then
					ctx.fireEvent(tgt.name)
				else
					ctx.fireEvent(tgt.name, p.v)
				end
				ctx.report({
					module = M.name,
					severity = "info",
					title = ("%s fired [%s]"):format(tgt.name, p.label),
					detail = "Fire-and-forget sent. INCONCLUSIVE until a probe or server log confirms a side-effect.",
				})
			end

			ctx.sleep(0.05)
		end
	end
end

return M
