--!strict
-- RTL_Schema: pure value-validation helpers shared by client and server.
-- Written as plain Lua (also valid Luau), so it is unit-testable outside Roblox.

local Schema = {}

function Schema.isFinite(n)
	return type(n) == "number" and n == n and n ~= math.huge and n ~= -math.huge
end

function Schema.isInteger(n)
	return Schema.isFinite(n) and math.floor(n) == n
end

function Schema.inRange(n, min, max)
	return Schema.isFinite(n) and n >= min and n <= max
end

function Schema.isType(v, t)
	return type(v) == t
end

-- Validate a single value against a spec table:
--   { type = "number", min = 0, max = 100, integer = true, finite = true }
-- Returns ok, reason.
function Schema.validateValue(value, spec)
	if spec.type ~= nil and type(value) ~= spec.type then
		return false, string.format("expected type %s, got %s", tostring(spec.type), type(value))
	end
	if type(value) == "number" then
		if spec.finite ~= false and not Schema.isFinite(value) then
			return false, "value is not finite (NaN/Inf)"
		end
		if spec.integer == true and not Schema.isInteger(value) then
			return false, "value must be an integer"
		end
		if spec.min ~= nil and value < spec.min then
			return false, string.format("value %s below min %s", tostring(value), tostring(spec.min))
		end
		if spec.max ~= nil and value > spec.max then
			return false, string.format("value %s above max %s", tostring(value), tostring(spec.max))
		end
	end
	return true, nil
end

-- Validate positional args against an array of specs. Returns ok, reason.
function Schema.validateArgs(args, specs)
	if #args ~= #specs then
		return false, string.format("expected %d args, got %d", #specs, #args)
	end
	for i, spec in ipairs(specs) do
		local ok, reason = Schema.validateValue(args[i], spec)
		if not ok then
			return false, string.format("arg #%d: %s", i, reason or "invalid")
		end
	end
	return true, nil
end

return Schema
