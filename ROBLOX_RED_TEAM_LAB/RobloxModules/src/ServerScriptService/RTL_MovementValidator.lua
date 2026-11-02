--!strict
-- RTL_MovementValidator: pure, server-authoritative movement checks.
-- Plain Lua (also valid Luau). The server computes distance/dt from
-- authoritative positions and timestamps; client-reported speed is never trusted.

local MovementValidator = {}

-- Implied horizontal speed for a displacement over dt seconds.
function MovementValidator.impliedSpeed(distance, dt)
	if dt <= 0 then
		return math.huge
	end
	return distance / dt
end

-- True if the implied speed is within the allowed maximum (with tolerance).
function MovementValidator.speedOK(distance, dt, maxSpeed, tolerance)
	local tol = tolerance or 1.0
	if dt <= 0 then
		return false -- zero/negative dt cannot justify any displacement
	end
	return MovementValidator.impliedSpeed(distance, dt) <= (maxSpeed * tol)
end

-- Teleport check: a single-tick displacement beyond maxSingleTickStuds is impossible.
function MovementValidator.teleportOK(distance, maxSingleTickStuds)
	return distance <= maxSingleTickStuds
end

-- Fly check: sustained unsupported air time beyond the allowed maximum is anomalous.
function MovementValidator.airTimeOK(airTimeSec, maxAirTimeSec)
	return airTimeSec <= maxAirTimeSec
end

-- Infinite-jump check: a jump is only valid when the server believes the player is grounded.
function MovementValidator.jumpAllowed(grounded)
	return grounded == true
end

return MovementValidator
