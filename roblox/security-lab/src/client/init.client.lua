--!strict
-- SecurityLab / Client bootstrap
-- Builds the context ("ctx") the attack modules run against, loads the modules,
-- and wires them to the control panel.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.SecurityLab.Config)
local Protocol = require(ReplicatedStorage.SecurityLab.Protocol)

local net = Protocol.waitClient()
if not net then
	warn("[SecurityLab] Lab server not present — client harness idle.")
	return
end

local modulesFolder = script:WaitForChild("AttackModules")
local Panel = require(script:WaitForChild("Panel"))

-- Resolve the game's remotes container from Config.RemotesParent.
local function resolveRemotes(): Instance?
	local node: Instance? = ReplicatedStorage
	for _, seg in ipairs(Config.RemotesParent) do
		node = node and node:FindFirstChild(seg)
	end
	return node
end
local remotes = resolveRemotes()

local function findRemote(name: string): Instance?
	return remotes and remotes:FindFirstChild(name) or nil
end

-- ---- Context passed to every attack module --------------------------------
local ctx = {}
ctx.config = Config
ctx.remotes = remotes

function ctx.sleep(t: number)
	task.wait(t)
end

function ctx.moveSample()
	local r = net.Control:InvokeServer({ op = "moveSample" })
	return r and r.ok and r.sample or nil
end

function ctx.probe(name: string)
	local r = net.Control:InvokeServer({ op = "probe", name = name })
	if not r or not r.ok then
		return false, r and r.err
	end
	return true, r.value
end

function ctx.fireEvent(name: string, ...)
	local rem = findRemote(name)
	if not rem or not rem:IsA("RemoteEvent") then
		return false, "missing RemoteEvent: " .. tostring(name)
	end
	rem:FireServer(...)
	return true
end

function ctx.invokeFunction(name: string, ...)
	local rem = findRemote(name)
	if not rem or not rem:IsA("RemoteFunction") then
		return false, "missing RemoteFunction: " .. tostring(name)
	end
	local packed = table.pack(...)
	return pcall(function()
		return rem:InvokeServer(table.unpack(packed, 1, packed.n))
	end)
end

function ctx.report(f)
	Panel.addFinding(f) -- local display
	net.Control:InvokeServer({ op = "report", finding = f }) -- central log
end

-- Findings raised by server-side probes/monitors also land in the panel.
net.Report.OnClientEvent:Connect(function(f)
	Panel.addFinding(f)
end)

-- ---- Load attack modules --------------------------------------------------
local modules = {}
for _, m in ipairs(modulesFolder:GetChildren()) do
	if m:IsA("ModuleScript") then
		local ok, mod = pcall(require, m)
		if ok and type(mod) == "table" and mod.run then
			table.insert(modules, mod)
		else
			warn("[SecurityLab] skipping bad module: " .. m.Name)
		end
	end
end
table.sort(modules, function(a, b)
	return (a.order or 50) < (b.order or 50)
end)

-- ---- Build the panel ------------------------------------------------------
Panel.build(modules, function(mod)
	task.spawn(function()
		Panel.log(("▶ Running: %s"):format(mod.name))
		local ok, err = pcall(mod.run, ctx)
		if not ok then
			Panel.log("✗ module error: " .. tostring(err))
		end
		Panel.log(("■ Finished: %s"):format(mod.name))
	end)
end, function()
	local r = net.Control:InvokeServer({ op = "export" })
	if r and r.ok then
		Panel.showExport(r.json)
	else
		Panel.log("export failed")
	end
end)

warn("[SecurityLab] Client panel ready. Remotes resolved: " .. (remotes and "yes" or "NO — check Config.RemotesParent"))
