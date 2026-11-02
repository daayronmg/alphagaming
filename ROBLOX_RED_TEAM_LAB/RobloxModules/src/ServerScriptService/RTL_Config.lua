--!strict
-- RTL_Config: central, server-owned configuration. Tune to your experience.
return {
	Movement = {
		MaxSpeedStudsPerSec = 24,   -- normal humanoid walk speed
		SpeedTolerance = 1.20,      -- allow 20% slack for latency/jitter
		MaxAirTimeSec = 1.5,        -- longest a legitimate jump stays airborne
		MaxSingleTickStuds = 50,    -- a single update should not move further than this
	},
	Rate = {
		DefaultLimit = 5,           -- max calls...
		DefaultWindowSec = 1.0,     -- ...per this window, per player, per remote
	},
	Economy = {
		MaxTransaction = 1000000,   -- upper bound on any single transaction amount
		MinTransaction = 1,
	},
	Roles = {
		-- higher number = more privilege
		player = 0,
		moderator = 50,
		admin = 100,
	},
}
