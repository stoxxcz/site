-- Анимация барабанов слотов на экране игрока.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Sounds = require(script.Parent.Sounds)
local UI = require(script.Parent.UI)

local SlotsView = {}

local SYMBOLS = Config.Slots.Symbols

local function machineName(id: number): string
	for _, machine in Config.Slots.Machines do
		if machine.Id == id then
			return machine.Name
		end
	end
	return ""
end

function SlotsView.Init(hud)
	local frame = UI.new("Frame", {
		Name = "Slots",
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -12, 0.5, 0),
		Size = UDim2.fromOffset(380, 190),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.05,
		Visible = false,
		ZIndex = 4,
		Parent = hud.Gui(),
	}, {
		UI.Corner(16),
		UI.Stroke(UI.Colors.Accent, 3),
		UI.new("UIScale"),
	})
	local title = UI.Label({
		Size = UDim2.new(1, -20, 0, 26),
		Position = UDim2.fromOffset(10, 6),
		Font = UI.FontBlack,
		TextColor3 = UI.Colors.Accent,
		ZIndex = 5,
		Parent = frame,
	})
	local reels: { TextLabel } = {}
	for i = 1, 3 do
		local box = UI.new("Frame", {
			Size = UDim2.fromOffset(100, 100),
			Position = UDim2.fromOffset(25 + (i - 1) * 115, 38),
			BackgroundColor3 = Color3.fromRGB(250, 245, 255),
			ZIndex = 5,
			Parent = frame,
		}, {
			UI.Corner(12),
			UI.Stroke(UI.Colors.Pink, 3),
		})
		reels[i] = UI.Label({
			Size = UDim2.fromScale(0.8, 0.8),
			Position = UDim2.fromScale(0.1, 0.1),
			Text = SYMBOLS[i].Icon,
			ZIndex = 6,
			Parent = box,
		})
	end
	local result = UI.Label({
		Size = UDim2.new(1, -20, 0, 36),
		Position = UDim2.new(0, 10, 1, -44),
		Font = UI.FontBlack,
		Text = "",
		ZIndex = 5,
		Parent = frame,
	})
	UI.TextStroke(2).Parent = result

	-- масштаб как у панелей
	task.defer(function()
		local scale = frame:FindFirstChildOfClass("UIScale")
		local status = hud.Gui():FindFirstChild("Status")
		local source = status and status:FindFirstChildOfClass("UIScale")
		if scale and source then
			scale.Scale = source.Scale
			source:GetPropertyChangedSignal("Scale"):Connect(function()
				scale.Scale = source.Scale
			end)
		end
	end)

	local token = 0
	Net.Event("SlotResult").OnClientEvent:Connect(function(machineId: number, icons: { string }, payout: number, stake: number, multiplier: number)
		token += 1
		local myToken = token
		frame.Visible = true
		title.Text = string.format("🎰 %s • ставка %s 💰", machineName(machineId), Config.Format(stake))
		result.Text = "Крутим..."
		result.TextColor3 = UI.Colors.Text
		local spinTime = Config.Slots.SpinTime - 0.1
		local stops = { spinTime * 0.45, spinTime * 0.7, spinTime }
		local started = os.clock()
		local stopped = { false, false, false }
		while os.clock() - started < spinTime do
			local elapsed = os.clock() - started
			for i = 1, 3 do
				if not stopped[i] then
					if elapsed >= stops[i] then
						stopped[i] = true
						reels[i].Text = icons[i]
						Sounds.Play("Click", 0.5, 0.8)
					else
						reels[i].Text = SYMBOLS[math.random(#SYMBOLS)].Icon
					end
				end
			end
			Sounds.Play("Tick", 0.15, 1.8)
			task.wait(0.07)
		end
		for i = 1, 3 do
			reels[i].Text = icons[i]
		end
		if payout > stake then
			result.Text = string.format("🎉 x%d! +%s 💰", multiplier, Config.Format(payout))
			result.TextColor3 = UI.Colors.Good
			Sounds.Play("Win", 0.6)
			if multiplier >= Config.Slots.BigWinMultiplier then
				hud.Announce(string.format("💥 ДЖЕКПОТ x%d!", multiplier), UI.Colors.Accent, 2.5)
			end
		elseif payout == stake then
			result.Text = "↩️ Возврат ставки"
			result.TextColor3 = UI.Colors.Cyan
		else
			result.Text = "Мимо... ещё разок? 😈"
			result.TextColor3 = UI.Colors.Bad
		end
		task.delay(3, function()
			if token == myToken then
				frame.Visible = false
			end
		end)
	end)
end

return SlotsView
