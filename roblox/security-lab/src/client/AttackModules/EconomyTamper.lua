--!strict
-- Module 2 — Economy / Parameter Tamper
-- Attempts classic economy abuses (negative quantity, client-supplied price,
-- repeated reward claims) and CONFIRMS success only by reading a 'balance' probe
-- before and after. No probe = reported INCONCLUSIVE, never as a confirmed bug.
--
-- Edit the remote name and argument shape to match YOUR purchase/reward API.

local M = { name = "Economy / Param Tamper", order = 20 }

function M.run(ctx)
	local okB, before = ctx.probe("balance")
	if not okB then
		ctx.report({
			module = M.name,
			severity = "info",
			title = "No 'balance' probe registered",
			detail = "Wire Probes.balance on the server to let this module CONFIRM economy exploits. "
				.. "Sending attacks anyway, but results stay INCONCLUSIVE.",
		})
	end

	-- 1) Negative quantity.
	do
		local ok, res = ctx.invokeFunction("BuyItem", "sword", -5)
		ctx.report({
			module = M.name,
			severity = "info",
			title = "BuyItem('sword', -5) sent",
			detail = ("invoke ok=%s res=%s"):format(tostring(ok), tostring(res)),
		})
	end

	-- 2) Client-supplied price = 0 (extra, attacker-controlled argument).
	ctx.invokeFunction("BuyItem", "sword", 1, 0)

	-- 3) Repeated reward claim (double-spend / race).
	for _ = 1, 5 do
		ctx.invokeFunction("ClaimReward", "daily")
	end

	ctx.sleep(0.5)

	if okB then
		local okA, after = ctx.probe("balance")
		if okA and type(before) == "number" and type(after) == "number" then
			if after > before then
				ctx.report({
					module = M.name,
					severity = "critical",
					title = "ECONOMY EXPLOIT CONFIRMED",
					detail = ("Balance rose %d -> %d after malformed/tampered calls. "):format(before, after)
						.. "Server trusted client input. Validate price/quantity server-side and make reward claims idempotent.",
				})
			elseif after == before then
				ctx.report({
					module = M.name,
					severity = "low",
					title = "Economy held",
					detail = "Balance unchanged — server rejected the tampering (good).",
				})
			else
				ctx.report({
					module = M.name,
					severity = "info",
					title = "Balance decreased",
					detail = ("%d -> %d (a legitimate purchase likely went through)."):format(before, after),
				})
			end
		end
	end
end

return M
