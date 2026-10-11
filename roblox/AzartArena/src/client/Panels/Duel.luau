-- Дуэли в монетку: вызов, приглашение и анимация броска.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Sounds = require(script.Parent.Parent.Sounds)
local UI = require(script.Parent.Parent.UI)

local player = Players.LocalPlayer

local Duel = {}

local HEADS = "👑"
local TAILS = "🌙"

function Duel.Init(hud)
	local gui = hud.Gui()
	local accent = Color3.fromRGB(60, 200, 255)
	local frame, content, close = UI.Panel(gui, "🪙 ДУЭЛЬ В МОНЕТКУ", UDim2.fromOffset(500, 500), accent)

	UI.Label({
		Size = UDim2.new(1, 0, 0, 40),
		Text = "Оба ставят одинаково. Победитель забирает всё!\nТы — " .. HEADS .. ", соперник — " .. TAILS,
		TextColor3 = UI.Colors.Muted,
		Font = UI.Font,
		ZIndex = 6,
		Parent = content,
	})
	local amountHolder = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 80),
		Position = UDim2.fromOffset(0, 46),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Parent = content,
	})
	local amount = UI.AmountSelector(amountHolder, 100)
	local list = UI.new("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -136),
		Position = UDim2.fromOffset(0, 134),
		BackgroundColor3 = UI.Colors.Panel,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		ZIndex = 5,
		Parent = content,
	}, {
		UI.Corner(10),
		UI.Padding(6),
		UI.new("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	})

	local function rebuild()
		for _, child in list:GetChildren() do
			if child:IsA("Frame") or child:IsA("TextLabel") then
				child:Destroy()
			end
		end
		local count = 0
		for _, target in Players:GetPlayers() do
			if target ~= player then
				count += 1
				local row = UI.new("Frame", {
					Size = UDim2.new(1, -4, 0, 48),
					BackgroundColor3 = UI.Colors.Panel2,
					LayoutOrder = count,
					ZIndex = 6,
					Parent = list,
				}, {
					UI.Corner(10),
				})
				UI.Label({
					Text = string.format(
						'%s  <font color="#FFC83C">💰 %s</font>',
						target.DisplayName,
						Config.Format(target:GetAttribute("Coins") or 0)
					),
					Size = UDim2.new(1, -150, 0, 28),
					Position = UDim2.fromOffset(10, 10),
					TextXAlignment = Enum.TextXAlignment.Left,
					Font = UI.FontBlack,
					ZIndex = 7,
					Parent = row,
				})
				local button = UI.Button("⚔️ Вызвать", accent, {
					Size = UDim2.fromOffset(130, 38),
					Position = UDim2.new(1, -136, 0, 5),
					ZIndex = 7,
					Parent = row,
				})
				button.Activated:Connect(function()
					Net.Event("DuelRequest"):FireServer(target.UserId, amount.Get())
				end)
			end
		end
		if count == 0 then
			UI.Label({
				Text = "Пока никого нет... Позови друзей! 👥",
				Size = UDim2.new(1, -4, 0, 40),
				TextColor3 = UI.Colors.Muted,
				ZIndex = 6,
				Parent = list,
			})
		end
	end

	hud.RegisterPanel("Duel", frame, close, rebuild)
	hud.AddMenuButton("duel", "🪙", "Дуэль", accent, 3, function()
		hud.OpenPanel("Duel")
	end)
	Players.PlayerAdded:Connect(function()
		if frame.Visible then
			rebuild()
		end
	end)
	Players.PlayerRemoving:Connect(function()
		task.defer(function()
			if frame.Visible then
				rebuild()
			end
		end)
	end)

	------------------------------------------------------------------
	-- Приглашение
	------------------------------------------------------------------
	local invite = UI.new("Frame", {
		Name = "DuelInvite",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -146),
		Size = UDim2.fromOffset(440, 124),
		BackgroundColor3 = UI.Colors.Bg,
		Visible = false,
		ZIndex = 8,
		Parent = gui,
	}, {
		UI.Corner(14),
		UI.Stroke(accent, 3),
		UI.new("UIScale"),
	})
	local inviteText = UI.Label({
		Size = UDim2.new(1, -20, 0, 50),
		Position = UDim2.fromOffset(10, 6),
		Font = UI.FontBlack,
		ZIndex = 9,
		Parent = invite,
	})
	local accept = UI.Button("✅ Принять", UI.Colors.Good, {
		Size = UDim2.new(0.5, -15, 0, 42),
		Position = UDim2.fromOffset(10, 62),
		ZIndex = 9,
		Parent = invite,
	})
	local decline = UI.Button("❌ Отказ", UI.Colors.Bad, {
		Size = UDim2.new(0.5, -15, 0, 42),
		Position = UDim2.new(0.5, 5, 0, 62),
		ZIndex = 9,
		Parent = invite,
	})
	local timerBar = UI.new("Frame", {
		Size = UDim2.new(1, -20, 0, 6),
		Position = UDim2.new(0, 10, 1, -12),
		BackgroundColor3 = accent,
		BorderSizePixel = 0,
		ZIndex = 9,
		Parent = invite,
	}, {
		UI.Corner(3),
	})
	local currentInvite: string? = nil
	local function respond(ok: boolean)
		if currentInvite then
			Net.Event("DuelRespond"):FireServer(currentInvite, ok)
		end
		currentInvite = nil
		invite.Visible = false
	end
	accept.Activated:Connect(function()
		respond(true)
	end)
	decline.Activated:Connect(function()
		respond(false)
	end)
	Net.Event("DuelInvite").OnClientEvent:Connect(function(id: string, fromName: string, bet: number, timeout: number)
		currentInvite = id
		inviteText.Text = string.format("⚔️ %s вызывает тебя на монетку!\nСтавка: %s 💰", fromName, Config.Format(bet))
		invite.Visible = true
		timerBar.Size = UDim2.new(1, -20, 0, 6)
		UI.Tween(timerBar, timeout, { Size = UDim2.new(0, 0, 0, 6) }, Enum.EasingStyle.Linear)
		Sounds.Play("Win", 0.5, 0.8)
		task.delay(timeout, function()
			if currentInvite == id then
				currentInvite = nil
				invite.Visible = false
			end
		end)
	end)

	------------------------------------------------------------------
	-- Бросок монетки
	------------------------------------------------------------------
	local flip = UI.new("Frame", {
		Name = "CoinFlip",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.45),
		Size = UDim2.fromOffset(420, 300),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.05,
		Visible = false,
		ZIndex = 10,
		Parent = gui,
	}, {
		UI.Corner(18),
		UI.Stroke(UI.Colors.Accent, 3),
		UI.new("UIScale"),
	})
	local vsLabel = UI.Label({
		Size = UDim2.new(1, -20, 0, 40),
		Position = UDim2.fromOffset(10, 10),
		Font = UI.FontBlack,
		ZIndex = 11,
		Parent = flip,
	})
	local coin = UI.new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(130, 130),
		BackgroundColor3 = Color3.fromRGB(255, 200, 50),
		ZIndex = 11,
		Parent = flip,
	}, {
		UI.new("UICorner", { CornerRadius = UDim.new(0.5, 0) }),
		UI.Stroke(Color3.fromRGB(170, 110, 0), 5),
		UI.Gradient(Color3.fromRGB(255, 230, 120), Color3.fromRGB(230, 150, 0)),
	})
	local face = UI.Label({
		Size = UDim2.fromScale(0.7, 0.7),
		Position = UDim2.fromScale(0.15, 0.15),
		Text = HEADS,
		ZIndex = 12,
		Parent = coin,
	})
	local resultLabel = UI.Label({
		Size = UDim2.new(1, -20, 0, 44),
		Position = UDim2.new(0, 10, 1, -54),
		Font = UI.FontBlack,
		Text = "",
		ZIndex = 11,
		Parent = flip,
	})
	UI.TextStroke(2).Parent = resultLabel

	Net.Event("DuelResult").OnClientEvent:Connect(function(data)
		hud.ClosePanel()
		flip.Visible = true
		resultLabel.Text = ""
		vsLabel.Text = string.format("%s %s  🆚  %s %s", HEADS, data.Challenger, data.Opponent, TAILS)
		local finalFace = data.ChallengerWins and HEADS or TAILS
		local duration = (data.FlipTime or 3) - 0.6
		local started = os.clock()
		local spins = 0
		while os.clock() - started < duration do
			local t = (os.clock() - started) / duration
			local speed = 0.04 + t * t * 0.18
			UI.Tween(coin, speed, { Size = UDim2.fromOffset(8, 130) })
			task.wait(speed)
			spins += 1
			face.Text = spins % 2 == 0 and HEADS or TAILS
			UI.Tween(coin, speed, { Size = UDim2.fromOffset(130, 130) })
			task.wait(speed)
			Sounds.Play("Tick", 0.25, 1.5)
		end
		face.Text = finalFace
		coin.Size = UDim2.fromOffset(130, 130)
		if data.YouWon then
			resultLabel.Text = string.format("🏆 ТЫ ВЫИГРАЛ %s 💰!", Config.Format(data.Amount * 2))
			resultLabel.TextColor3 = UI.Colors.Good
			Sounds.Play("Win", 0.6)
		else
			resultLabel.Text = string.format("😭 Победил %s", data.Winner)
			resultLabel.TextColor3 = UI.Colors.Bad
			Sounds.Play("Lose", 0.5)
		end
		task.wait(2.6)
		flip.Visible = false
	end)

	-- общий масштаб для всплывающих окон
	local function syncScales()
		local panelScale = frame:FindFirstChildOfClass("UIScale")
		local value = panelScale and panelScale.Scale or 1
		for _, popup in { invite, flip } do
			local scale = popup:FindFirstChildOfClass("UIScale")
			if scale then
				scale.Scale = value
			end
		end
	end
	local panelScale = frame:FindFirstChildOfClass("UIScale")
	if panelScale then
		panelScale:GetPropertyChangedSignal("Scale"):Connect(syncScales)
	end
	syncScales()
end

return Duel
