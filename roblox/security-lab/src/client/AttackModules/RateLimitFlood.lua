--!strict
-- Module 3 — Rate-limit / Flood
-- Fires a burst at the first configured target to probe throttling/cooldowns.
-- Throughput alone is not a verdict: whether the server PROCESSED every call is
-- what matters, so confirm with a counter probe or your server logs.

local RS = game:GetService("ReplicatedStorage")
local Config = require(RS.SecurityLab.Config)

local M = { name = "Rate-limit / Flood", order = 30 }

function M.run(ctx)
	local tgt = Config.Targets[1]
	if not tgt then
		ctx.report({
			module = M.name,
			severity = "info",
			title = "No target",
			detail = "Configure at least one target in Config.Targets.",
		})
		return
	end

	-- Optional: register Probes.actionCount to count how many the server accepted.
	local hadProbe, countBefore = ctx.probe("actionCount")

	local N = 500
	local t0 = os.clock()
	for _ = 1, N do
		if tgt.kind == "Function" then
			pcall(function()
				ctx.invokeFunction(tgt.name)
			end)
		else
			ctx.fireEvent(tgt.name)
		end
	end
	local dt = math.max(0.001, os.clock() - t0)

	ctx.report({
		module = M.name,
		severity = "info",
		title = ("Sent %d calls in %.2fs (%.0f/s) to %s"):format(N, dt, N / dt, tgt.name),
		detail = "Throughput only. A real rate-limit should reject, queue, or kick well before this.",
	})

	if hadProbe and type(countBefore) == "number" then
		ctx.sleep(0.5)
		local okA, countAfter = ctx.probe("actionCount")
		if okA and type(countAfter) == "number" then
			local processed = countAfter - countBefore
			local sev = processed > 50 and "high" or "low"
			ctx.report({
				module = M.name,
				severity = sev,
				title = ("Server processed %d / %d"):format(processed, N),
				detail = processed > 50
						and "Weak or absent rate-limit — most of the flood was accepted."
					or "Most of the flood was dropped — throttling is working.",
			})
		end
	end
end

return M
