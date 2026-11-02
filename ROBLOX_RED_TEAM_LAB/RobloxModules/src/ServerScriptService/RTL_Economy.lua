--!strict
-- RTL_Economy: pure, server-authoritative economy & inventory.
-- Plain Lua (also valid Luau). Balances, granted rewards and inventory are
-- owned here. Client-supplied amounts are validated; client-supplied balances
-- are ignored by design.

local Economy = {}
Economy.__index = Economy

function Economy.new(startingBalance)
	return setmetatable({
		balance = startingBalance or 0,
		grantedRewards = {},
		inventory = {},
	}, Economy)
end

local function validAmount(amount, minT, maxT)
	if type(amount) ~= "number" or amount ~= amount or amount == math.huge or amount == -math.huge then
		return false, "amount not finite"
	end
	if amount < minT then
		return false, "amount below minimum"
	end
	if amount > maxT then
		return false, "amount above maximum"
	end
	return true, nil
end

-- Add funds only via a validated, server-initiated transaction amount.
function Economy.deposit(self, amount, minT, maxT)
	local ok, reason = validAmount(amount, minT, maxT)
	if not ok then
		return false, reason
	end
	self.balance = self.balance + amount
	return true, nil
end

-- Spend funds; never allows the balance to go negative (double-spend safe when
-- called serially, which is how the server should process requests per player).
function Economy.withdraw(self, amount, minT, maxT)
	local ok, reason = validAmount(amount, minT, maxT)
	if not ok then
		return false, reason
	end
	if amount > self.balance then
		return false, "insufficient funds"
	end
	self.balance = self.balance - amount
	return true, nil
end

-- Idempotent reward grant: a given rewardId is granted at most once.
function Economy.grantReward(self, rewardId, amount, minT, maxT)
	if self.grantedRewards[rewardId] then
		return false, "reward already granted"
	end
	local ok, reason = Economy.deposit(self, amount, minT, maxT)
	if not ok then
		return false, reason
	end
	self.grantedRewards[rewardId] = true
	return true, nil
end

-- Inventory additions require a truthy, server-verified acquisition source.
function Economy.addItem(self, itemId, qty, source)
	if not source then
		return false, "no valid acquisition source"
	end
	if type(qty) ~= "number" or qty <= 0 or math.floor(qty) ~= qty then
		return false, "invalid quantity"
	end
	self.inventory[itemId] = (self.inventory[itemId] or 0) + qty
	return true, nil
end

return Economy
