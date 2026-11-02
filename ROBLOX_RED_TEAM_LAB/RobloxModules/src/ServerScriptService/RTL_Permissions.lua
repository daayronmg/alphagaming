--!strict
-- RTL_Permissions: pure role/authorization checks. Plain Lua (also valid Luau).
-- Roles are server-owned; players can never assign their own role.

local Permissions = {}

-- ranks: { player = 0, moderator = 50, admin = 100 }
function Permissions.hasAtLeast(ranks, playerRole, requiredRole)
	local have = ranks[playerRole]
	local need = ranks[requiredRole]
	if have == nil or need == nil then
		return false
	end
	return have >= need
end

-- Authorize an action that requires a minimum role. Returns ok, reason.
function Permissions.authorize(ranks, playerRole, requiredRole, action)
	if Permissions.hasAtLeast(ranks, playerRole, requiredRole) then
		return true, nil
	end
	return false, string.format("role '%s' lacks '%s' required for %s",
		tostring(playerRole), tostring(requiredRole), action)
end

return Permissions
