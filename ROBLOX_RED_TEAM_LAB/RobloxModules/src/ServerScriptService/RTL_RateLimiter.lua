--!strict
-- RTL_RateLimiter: pure sliding-window rate limiter.
-- Plain Lua (also valid Luau). The clock is injected into :allow(now) so it is
-- deterministic under test.

local RateLimiter = {}
RateLimiter.__index = RateLimiter

function RateLimiter.new(limit, window)
	return setmetatable({
		limit = limit,
		window = window,
		stamps = {},
	}, RateLimiter)
end

-- Returns true if a call at time `now` is allowed; records it when allowed.
function RateLimiter.allow(self, now)
	local cutoff = now - self.window
	local kept = {}
	for _, t in ipairs(self.stamps) do
		if t > cutoff then
			table.insert(kept, t)
		end
	end
	self.stamps = kept
	if #self.stamps >= self.limit then
		return false
	end
	table.insert(self.stamps, now)
	return true
end

return RateLimiter
