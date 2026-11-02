--!strict
-- SecurityLab / Protocol
-- Builds and resolves the lab's OWN internal remotes (separate from your game's).
-- These are used only to stream findings to the panel and to query server-side
-- oracles ("probes"). They are not part of your game.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Protocol = {}
local FOLDER = "SecurityLab_Net"

function Protocol.buildServer()
	local f = ReplicatedStorage:FindFirstChild(FOLDER)
	if not f then
		f = Instance.new("Folder")
		f.Name = FOLDER
		f.Parent = ReplicatedStorage
	end
	local function ensure(name: string, class: string): Instance
		local o = f:FindFirstChild(name)
		if not o then
			o = Instance.new(class)
			o.Name = name
			o.Parent = f
		end
		return o
	end
	return {
		Folder = f,
		Report = ensure("Report", "RemoteEvent"), -- server -> clients (findings stream)
		Control = ensure("Control", "RemoteFunction"), -- client -> server (probe / report / log)
	}
end

function Protocol.waitClient()
	local f = ReplicatedStorage:WaitForChild(FOLDER, 30)
	if not f then
		return nil
	end
	return {
		Folder = f,
		Report = f:WaitForChild("Report"),
		Control = f:WaitForChild("Control"),
	}
end

return Protocol
