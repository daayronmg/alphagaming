--!strict
-- SecurityLab / Panel
-- The control panel GUI: module list, live colour-coded finding log, counters,
-- and a JSON export dialog. Built entirely in code — no pre-made GUI assets.

local Players = game:GetService("Players")

local Panel = {}

local SEV = {
	critical = Color3.fromRGB(255, 70, 70),
	high = Color3.fromRGB(255, 140, 40),
	medium = Color3.fromRGB(255, 210, 60),
	low = Color3.fromRGB(120, 220, 120),
	info = Color3.fromRGB(150, 180, 255),
}

local gui: ScreenGui
local logFrame: ScrollingFrame
local countLabel: TextLabel
local findings = {}

local function mk(class: string, props: { [string]: any }, parent: Instance?): any
	local o = Instance.new(class)
	for k, v in pairs(props) do
		(o :: any)[k] = v
	end
	if parent then
		o.Parent = parent
	end
	return o
end

function Panel.build(modules, onRun, onExport)
	local pg = Players.LocalPlayer:WaitForChild("PlayerGui")
	gui = mk("ScreenGui", {
		Name = "SecurityLab",
		ResetOnSpawn = false,
		IgnoreGuiInset = true,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	}, pg)

	local root = mk("Frame", {
		Size = UDim2.fromOffset(420, 540),
		Position = UDim2.new(1, -440, 0, 20),
		BackgroundColor3 = Color3.fromRGB(18, 20, 26),
		BorderSizePixel = 0,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 10) }, root)
	mk("UIStroke", { Color = Color3.fromRGB(60, 70, 90), Thickness = 1 }, root)

	local header = mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 40),
		BackgroundColor3 = Color3.fromRGB(28, 32, 42),
		BorderSizePixel = 0,
		Text = "  🛡  SECURITY LAB — in-Studio audit",
		TextColor3 = Color3.fromRGB(230, 235, 245),
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, root)
	mk("UICorner", { CornerRadius = UDim.new(0, 10) }, header)

	local modList = mk("ScrollingFrame", {
		Size = UDim2.new(1, -16, 0, 150),
		Position = UDim2.new(0, 8, 0, 48),
		BackgroundColor3 = Color3.fromRGB(24, 27, 35),
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, root)
	mk("UICorner", { CornerRadius = UDim.new(0, 8) }, modList)
	mk("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, modList)
	mk("UIPadding", {
		PaddingTop = UDim.new(0, 6),
		PaddingLeft = UDim.new(0, 6),
		PaddingRight = UDim.new(0, 6),
	}, modList)

	for i, mod in ipairs(modules) do
		local btn = mk("TextButton", {
			Size = UDim2.new(1, 0, 0, 30),
			BackgroundColor3 = Color3.fromRGB(40, 46, 60),
			BorderSizePixel = 0,
			Text = "  ▶   " .. mod.name,
			TextColor3 = Color3.fromRGB(220, 225, 235),
			Font = Enum.Font.GothamMedium,
			TextSize = 13,
			TextXAlignment = Enum.TextXAlignment.Left,
			LayoutOrder = i,
			AutoButtonColor = true,
		}, modList)
		mk("UICorner", { CornerRadius = UDim.new(0, 6) }, btn)
		btn.MouseButton1Click:Connect(function()
			onRun(mod)
		end)
	end

	countLabel = mk("TextLabel", {
		Size = UDim2.new(1, -16, 0, 20),
		Position = UDim2.new(0, 8, 0, 204),
		BackgroundTransparency = 1,
		Text = "Findings: 0",
		TextColor3 = Color3.fromRGB(170, 180, 200),
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, root)

	logFrame = mk("ScrollingFrame", {
		Size = UDim2.new(1, -16, 1, -290),
		Position = UDim2.new(0, 8, 0, 228),
		BackgroundColor3 = Color3.fromRGB(12, 14, 18),
		BorderSizePixel = 0,
		ScrollBarThickness = 5,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, root)
	mk("UICorner", { CornerRadius = UDim.new(0, 8) }, logFrame)
	mk("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }, logFrame)
	mk("UIPadding", {
		PaddingTop = UDim.new(0, 6),
		PaddingLeft = UDim.new(0, 8),
		PaddingRight = UDim.new(0, 8),
		PaddingBottom = UDim.new(0, 6),
	}, logFrame)

	local exportBtn = mk("TextButton", {
		Size = UDim2.new(1, -16, 0, 30),
		Position = UDim2.new(0, 8, 1, -38),
		BackgroundColor3 = Color3.fromRGB(50, 90, 70),
		BorderSizePixel = 0,
		Text = "⬇  Export JSON report",
		TextColor3 = Color3.fromRGB(225, 245, 230),
		Font = Enum.Font.GothamBold,
		TextSize = 13,
	}, root)
	mk("UICorner", { CornerRadius = UDim.new(0, 6) }, exportBtn)
	exportBtn.MouseButton1Click:Connect(onExport)
end

local function addLine(text: string, color: Color3?)
	if not logFrame then
		return
	end
	mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		Text = text,
		TextColor3 = color or Color3.fromRGB(200, 205, 215),
		Font = Enum.Font.Code,
		TextSize = 12,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		LayoutOrder = #logFrame:GetChildren(),
	}, logFrame)
end

function Panel.log(text: string)
	addLine(text, Color3.fromRGB(150, 160, 180))
end

function Panel.addFinding(f)
	table.insert(findings, f)
	if countLabel then
		countLabel.Text = "Findings: " .. #findings
	end
	local sev = tostring(f.severity or "info"):lower()
	local color = SEV[sev] or SEV.info
	addLine(("[%s] %s"):format(sev:upper(), tostring(f.title or "finding")), color)
	if f.detail then
		addLine("    " .. tostring(f.detail), Color3.fromRGB(165, 172, 186))
	end
end

function Panel.showExport(json: string?)
	if not gui then
		return
	end
	local overlay = mk("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(0, 0, 0),
		BackgroundTransparency = 0.4,
		ZIndex = 10,
	}, gui)
	local box = mk("Frame", {
		Size = UDim2.fromOffset(620, 420),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Color3.fromRGB(20, 22, 28),
		ZIndex = 11,
	}, overlay)
	mk("UICorner", { CornerRadius = UDim.new(0, 10) }, box)
	mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 30),
		BackgroundTransparency = 1,
		ZIndex = 12,
		Text = "Report JSON — click, Ctrl+A, Ctrl+C to copy",
		TextColor3 = Color3.fromRGB(230, 235, 245),
		Font = Enum.Font.GothamBold,
		TextSize = 13,
	}, box)
	local tb = mk("TextBox", {
		Size = UDim2.new(1, -20, 1, -74),
		Position = UDim2.new(0, 10, 0, 36),
		BackgroundColor3 = Color3.fromRGB(12, 14, 18),
		TextColor3 = Color3.fromRGB(190, 200, 215),
		Font = Enum.Font.Code,
		TextSize = 11,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		MultiLine = true,
		ClearTextOnFocus = false,
		Text = json or "",
		ZIndex = 12,
	}, box)
	mk("UICorner", { CornerRadius = UDim.new(0, 6) }, tb)
	local close = mk("TextButton", {
		Size = UDim2.new(0, 120, 0, 28),
		Position = UDim2.new(0.5, -60, 1, -32),
		BackgroundColor3 = Color3.fromRGB(60, 70, 90),
		Text = "Close",
		TextColor3 = Color3.fromRGB(230, 235, 245),
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		ZIndex = 12,
	}, box)
	mk("UICorner", { CornerRadius = UDim.new(0, 6) }, close)
	close.MouseButton1Click:Connect(function()
		overlay:Destroy()
	end)
	-- Also dump to Output so you can copy from there if preferred.
	print("[SecurityLab] === REPORT JSON ===\n" .. (json or "(empty)"))
end

return Panel
