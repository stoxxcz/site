-- Панель рулетки: ставки на цвет, история, мини-табло вращения.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Sounds = require(script.Parent.Parent.Sounds)
local UI = require(script.Parent.Parent.UI)

local state = Net.State()
local RC = Config.Roulette

local Roulette = {}

function Roulette.Init(hud)
	local accent = Color3.fromRGB(220, 40, 60)
	local frame, content, close = UI.Panel(hud.Gui(), "🎡 РУЛЕТКА", UDim2.fromOffset(540, 560), accent)

	local timer = UI.Label({
		Size = UDim2.new(1, 0, 0, 28),
		Font = UI.FontBlack,
		TextColor3 = UI.Colors.Accent,
		ZIndex = 6,
		Parent = content,
	})

	local historyRow = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 26),
		Position = UDim2.fromOffset(0, 32),
		BackgroundTransparency = 1,
		ZIndex = 6,
		Parent = content,
	}, {
		UI.new("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			Padding = UDim.new(0, 5),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})

	local display = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 86),
		Position = UDim2.fromOffset(0, 64),
		BackgroundColor3 = RC.Colors.green.Color,
		ZIndex = 6,
		Parent = content,
	}, {
		UI.Corner(14),
		UI.Stroke(UI.Colors.Accent, 3),
	})
	local displayLabel = UI.Label({
		Size = UDim2.new(1, -20, 1, -16),
		Position = UDim2.fromOffset(10, 8),
		Font = UI.FontBlack,
		Text = "Делай ставку!",
		ZIndex = 7,
		Parent = display,
	})
	UI.TextStroke(3).Parent = displayLabel

	local amountHolder = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 80),
		Position = UDim2.fromOffset(0, 160),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Parent = content,
	})
	local amount = UI.AmountSelector(amountHolder, 50)

	local buttonsRow = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 150),
		Position = UDim2.fromOffset(0, 250),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Parent = content,
	}, {
		UI.new("UIGridLayout", {
			CellSize = UDim2.new(1 / 3, -8, 1, 0),
			CellPadding = UDim2.fromOffset(10, 0),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})

	local totalLabels: { [string]: TextLabel } = {}
	local mineLabels: { [string]: TextLabel } = {}
	for i, colorId in RC.ColorOrder do
		local info = RC.Colors[colorId]
		local button = UI.Button("", colorId == "black" and Color3.fromRGB(45, 45, 55) or info.Color, {
			LayoutOrder = i,
			ZIndex = 6,
			Parent = buttonsRow,
		})
		UI.Label({
			Text = string.format("%s %s", info.Icon, info.Name),
			Size = UDim2.new(1, 0, 0.3, 0),
			Font = UI.FontBlack,
			ZIndex = 7,
			Parent = button,
		})
		UI.Label({
			Text = "x" .. info.Multiplier,
			Size = UDim2.new(1, 0, 0.26, 0),
			Position = UDim2.fromScale(0, 0.3),
			Font = UI.FontBlack,
			TextColor3 = UI.Colors.Accent,
			ZIndex = 7,
			Parent = button,
		})
		totalLabels[colorId] = UI.Label({
			Text = "Всего: 0",
			Size = UDim2.new(1, 0, 0.18, 0),
			Position = UDim2.fromScale(0, 0.6),
			TextColor3 = Color3.fromRGB(230, 230, 240),
			ZIndex = 7,
			Parent = button,
		})
		mineLabels[colorId] = UI.Label({
			Text = "Твоя: 0",
			Size = UDim2.new(1, 0, 0.18, 0),
			Position = UDim2.fromScale(0, 0.8),
			TextColor3 = UI.Colors.Accent,
			ZIndex = 7,
			Parent = button,
		})
		button.Activated:Connect(function()
			Net.Event("RouletteBet"):FireServer(colorId, amount.Get())
			Sounds.Play("Click", 0.4, 1.4)
		end)
	end

	UI.Label({
		Size = UDim2.new(1, 0, 0, 36),
		Position = UDim2.new(0, 0, 1, -38),
		Text = "Колесо стоит в лобби слева от спавна. Ставки принимаются, пока идёт отсчёт.",
		TextColor3 = UI.Colors.Muted,
		Font = UI.Font,
		TextWrapped = true,
		ZIndex = 6,
		Parent = content,
	})

	local function refreshHistory()
		for _, child in historyRow:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local raw = tostring(state:GetAttribute("RouletteHistory") or "")
		local i = 0
		for colorId in string.gmatch(raw, "[^,]+") do
			local info = RC.Colors[colorId]
			if info then
				i += 1
				UI.new("Frame", {
					Size = UDim2.fromOffset(22, 22),
					BackgroundColor3 = info.Color,
					LayoutOrder = i,
					ZIndex = 7,
					Parent = historyRow,
				}, {
					UI.Corner(11),
					UI.Stroke(i == 1 and UI.Colors.Accent or Color3.new(1, 1, 1), i == 1 and 2.5 or 1),
				})
			end
		end
	end

	local function refreshTotals()
		local ok, totals = pcall(function()
			return HttpService:JSONDecode(tostring(state:GetAttribute("RouletteTotals") or "{}"))
		end)
		if not ok or type(totals) ~= "table" then
			return
		end
		for colorId, label in totalLabels do
			label.Text = "Всего: " .. Config.Format(totals[colorId] or 0)
		end
	end

	local spinning = false
	task.spawn(function()
		while true do
			local phase = state:GetAttribute("RoulettePhase")
			local left = math.max(0, math.ceil((state:GetAttribute("RouletteEndsAt") or 0) - Net.Now()))
			if phase == "Betting" then
				timer.Text = string.format("⏳ Приём ставок: %d с", left)
				if not spinning then
					displayLabel.Text = "Делай ставку!"
				end
			elseif phase == "Spinning" then
				timer.Text = "🎡 Крутим..."
			else
				timer.Text = "Новый круг через " .. left .. " с"
			end
			task.wait(0.2)
		end
	end)

	Net.Event("RouletteSpin").OnClientEvent:Connect(function(index: number, _offset: number, resultColor: string, spinTime: number)
		spinning = true
		local segments = RC.Segments
		local count = #segments
		local start = math.random(count)
		local steps = count * 3 + ((index - start) % count)
		local duration = math.max(1, spinTime - 0.9)
		local base = 0.03
		local weights = 0
		for i = 1, steps do
			weights += (i / steps) ^ 2
		end
		local k = math.max(0, (duration - steps * base) / weights)
		task.spawn(function()
			for i = 1, steps do
				local seg = segments[(start + i - 1) % count + 1]
				display.BackgroundColor3 = seg == "black" and Color3.fromRGB(45, 45, 55) or RC.Colors[seg].Color
				displayLabel.Text = RC.Colors[seg].Icon
				task.wait(base + k * (i / steps) ^ 2)
			end
			local info = RC.Colors[resultColor]
			display.BackgroundColor3 = resultColor == "black" and Color3.fromRGB(45, 45, 55) or info.Color
			displayLabel.Text = string.format("%s %s!", info.Icon, info.Name)
			task.wait(3)
			spinning = false
		end)
	end)

	Net.Event("RouletteMyBets").OnClientEvent:Connect(function(bets)
		for colorId, label in mineLabels do
			label.Text = "Твоя: " .. Config.Format((bets and bets[colorId]) or 0)
		end
	end)

	state:GetAttributeChangedSignal("RouletteHistory"):Connect(refreshHistory)
	state:GetAttributeChangedSignal("RouletteTotals"):Connect(refreshTotals)
	refreshHistory()
	refreshTotals()

	hud.RegisterPanel("Roulette", frame, close)
	hud.AddMenuButton("roulette", "🎡", "Рулетка", Color3.fromRGB(255, 80, 90), 2, function()
		hud.OpenPanel("Roulette")
	end)
end

return Roulette
