--!strict
-- SecurityLab / Config
-- Central configuration for the in-Studio security test harness.
-- EDIT THIS FILE to point the lab at YOUR game's remotes and probes.

local Config = {}

-- ---------------------------------------------------------------------------
-- SAFETY GUARD
-- The lab REFUSES to initialise unless at least one of these holds. This keeps
-- the harness out of your live/production servers. Never ship it enabled.
-- ---------------------------------------------------------------------------
Config.AllowInStudio = true
-- A PlaceId you use ONLY for testing. Set to your test place id, or leave 0.
Config.TestPlaceId = 0
-- Optional boolean attribute on Workspace that marks a server as a sanctioned lab.
Config.LabAttribute = "SecurityLabEnabled"

-- ---------------------------------------------------------------------------
-- WHERE YOUR REMOTES LIVE
-- Path segments under ReplicatedStorage to the Folder/Instance that holds your
-- RemoteEvents / RemoteFunctions. Example: ReplicatedStorage.Remotes
-- ---------------------------------------------------------------------------
Config.RemotesParent = { "Remotes" }

-- ---------------------------------------------------------------------------
-- TARGETS
-- Declare the remotes you want to exercise.
--   name : the Instance name under RemotesParent
--   kind : "Event" | "Function"
--   args : informational only — the argument shape you expect (for your notes)
-- ---------------------------------------------------------------------------
Config.Targets = {
	-- { name = "BuyItem", kind = "Function", args = { "string", "number" } },
	-- { name = "Attack",  kind = "Event",    args = { "Instance", "number" } },
}

-- ---------------------------------------------------------------------------
-- FUZZING PAYLOADS
-- Values tried against the first argument slot of each target. MISSING means
-- "call with no argument at all".
-- ---------------------------------------------------------------------------
Config.MISSING = setmetatable({}, { __tostring = function() return "<missing>" end })

Config.payloads = {
	{ label = "missing",          v = Config.MISSING },
	{ label = "nan",              v = 0 / 0 },
	{ label = "inf",              v = math.huge },
	{ label = "-inf",             v = -math.huge },
	{ label = "negative",         v = -1 },
	{ label = "int_min",          v = -2147483648 },
	{ label = "huge_number",      v = 2 ^ 53 },
	{ label = "empty_string",     v = "" },
	{ label = "oversized_string", v = string.rep("A", 100000) },
	{ label = "unexpected_table", v = {} },
	{ label = "bool",             v = true },
	{ label = "foreign_instance", v = workspace },
}

return Config
