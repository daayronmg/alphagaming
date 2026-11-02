--!strict
-- RTL_Telemetry: aggregates recorded anomalies into a risk summary.
-- Plain Lua (also valid Luau). Consumes a logger's records and RTL_RiskScore.

local Telemetry = {}

-- records: array of records with optional .status/.severity fields set by the
-- harness. Returns a summary table.
function Telemetry.summarize(records, RiskScore)
	local counts = { PASS = 0, FAIL = 0, INCONCLUSIVE = 0, PENDING = 0 }
	local entries = {}
	for _, r in ipairs(records) do
		local status = r.status or "PENDING"
		counts[status] = (counts[status] or 0) + 1
		table.insert(entries, { status = status, severity = r.severity or "INFO" })
	end
	return {
		total = #records,
		passed = counts.PASS,
		failed = counts.FAIL,
		inconclusive = counts.INCONCLUSIVE,
		pending = counts.PENDING,
		risk_score = RiskScore.score(entries),
	}
end

return Telemetry
