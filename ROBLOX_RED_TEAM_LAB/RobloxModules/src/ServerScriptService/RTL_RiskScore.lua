--!strict
-- RTL_RiskScore: pure aggregate risk scoring (mirrors the Python evaluator).
-- Plain Lua (also valid Luau).

local RiskScore = {}

RiskScore.Weight = {
	INFO = 0,
	LOW = 25,
	MEDIUM = 50,
	HIGH = 75,
	CRITICAL = 100,
}

-- entries: array of { status = "FAIL"|"PASS"|..., severity = "HIGH"|... }
-- Only FAIL contributes its severity weight; INCONCLUSIVE adds 10; capped at 100.
function RiskScore.score(entries)
	local exposure = 0
	for _, e in ipairs(entries) do
		if e.status == "FAIL" then
			exposure = exposure + (RiskScore.Weight[e.severity] or 0)
		elseif e.status == "INCONCLUSIVE" then
			exposure = exposure + 10
		end
	end
	if exposure > 100 then
		return 100
	end
	return exposure
end

return RiskScore
