--!strict
-- RTL_Logger: collects evaluation records and emits them in the exact JSON
-- shape the Windows app ingests. Plain Lua (also valid Luau). The harness /
-- bootstrap is responsible for JSON-encoding and exporting the table.

local Logger = {}
Logger.__index = Logger

function Logger.new()
	return setmetatable({ records = {} }, Logger)
end

-- Honesty guard, mirrored from the Python evaluator: a HYPERION attribution with
-- no evidence is downgraded to UNKNOWN before it is ever recorded.
function Logger.add(self, rec)
	if rec.detection_source == "HYPERION" and (rec.evidence == nil or #rec.evidence == 0) then
		rec.detection_source = "UNKNOWN"
		rec.evidence = { "Downgraded from HYPERION to UNKNOWN: no verifiable evidence." }
	end
	table.insert(self.records, rec)
end

-- Returns a table ready to be JSONEncoded as { results = {...} }.
function Logger.toPayload(self)
	return { results = self.records }
end

return Logger
