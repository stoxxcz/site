-- Панель ставок на победителя раунда (тотализатор).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local UI = require(script.Parent.Parent.UI)

local player = Players.LocalPlayer
local state = Net.State()

local Bets = {}

local pools: { [string]: number } = {}
local mine: { [string]: number } = {}
local total = 0
local thumbnails: { [number]: string } = {}

function Bets.Init(hud)
	local accent = Color3.fromRGB(255, 140, 0)
	local frame, content, close = UI.Panel(hud.Gui(), "🎲 СТАВКИ НА ПОБЕДИТЕЛЯ", UDim2.fromOffset(540, 540), accent)

	local info = UI.Label({
		Size = UDim2.new(1, 0, 0, 26),
		TextColor3 = UI.Colors.Accent,
		Font = UI.FontBlack,
		ZIndex = 6,
		Parent = content,
	})
	local bank = UI.Label({
		Size = UDim2.new(1, 0, 0, 20),
		Position = UDim2.fromOffset(0, 28),
		TextColor3 = UI.Colors.Muted,
		ZIndex = 6,
		Parent = content,
	})
	local amountHolder = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 80),
		Position = UDim2.fromOffset(0, 54),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Parent = content,
	})
	local amount = UI.AmountSelector(amountHolder, 50)
	local list = UI.new("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -170),
		Position = UDim2.fromOffset(0, 142),
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
	UI.Label({
		Size = UDim2.new(1, 0, 0, 18),
		Position = UDim2.new(0, 0, 1, -20),
		Text = "Угадал победителя — делишь весь банк (+25% от казино + джекпот)!",
		TextColor3 = UI.Colors.Muted,
		Font = UI.Font,
		ZIndex = 6,
		Parent = content,
	})

	local function rebuild()
		for _, child in list:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local jackpot = state:GetAttribute("Jackpot") or 0
		local prize = math.floor(total * Config.Betting.HouseBonus) + jackpot
		for i, target in Players:GetPlayers() do
			local key = tostring(target.UserId)
			local pool = pools[key] or 0
			local my = mine[key] or 0
			local row = UI.new("Frame", {
				Size = UDim2.new(1, -4, 0, 54),
				BackgroundColor3 = target == player and Color3.fromRGB(60, 45, 20) or UI.Colors.Panel2,
				LayoutOrder = i,
				ZIndex = 6,
				Parent = list,
			}, {
				UI.Corner(10),
			})
			local avatar = UI.new("ImageLabel", {
				Size = UDim2.fromOffset(44, 44),
				Position = UDim2.fromOffset(5, 5),
				BackgroundColor3 = UI.Colors.Bg,
				Image = thumbnails[target.UserId] or "",
				ZIndex = 7,
				Parent = row,
			}, {
				UI.Corner(22),
			})
			if not thumbnails[target.UserId] then
				task.spawn(function()
					local ok, image = pcall(function()
						return Players:GetUserThumbnailAsync(target.UserId, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size100x100)
					end)
					if ok and image then
						thumbnails[target.UserId] = image
						if avatar.Parent then
							avatar.Image = image
						end
					end
				end)
			end
			UI.Label({
				Text = target.DisplayName .. (target == player and " (ты)" or ""),
				Size = UDim2.new(1, -190, 0, 24),
				Position = UDim2.fromOffset(56, 4),
				TextXAlignment = Enum.TextXAlignment.Left,
				Font = UI.FontBlack,
				ZIndex = 7,
				Parent = row,
			})
			local odds = pool > 0 and string.format("кэф x%.1f", prize / pool) or "кэф —"
			UI.Label({
				Text = string.format(
					'Банк: %s • <font color="#FFC83C">Твоя: %s</font> • %s',
					Config.Format(pool),
					Config.Format(my),
					odds
				),
				Size = UDim2.new(1, -190, 0, 18),
				Position = UDim2.fromOffset(56, 30),
				TextXAlignment = Enum.TextXAlignment.Left,
				TextColor3 = UI.Colors.Muted,
				ZIndex = 7,
				Parent = row,
			})
			local button = UI.Button("Поставить", UI.Colors.Good, {
				Size = UDim2.fromOffset(120, 40),
				Position = UDim2.new(1, -126, 0, 7),
				ZIndex = 7,
				Parent = row,
			})
			button.Activated:Connect(function()
				Net.Event("PlaceBet"):FireServer(target.UserId, amount.Get())
			end)
		end
	end

	local function refreshInfo()
		local open = state:GetAttribute("BetsOpen") == true
		if open then
			local left = math.max(0, math.ceil((state:GetAttribute("EndsAt") or 0) - Net.Now()))
			info.Text = string.format("Далее: %s • приём ставок %d с", tostring(state:GetAttribute("Next") or ""), left)
		else
			info.Text = "🔒 Ставки закрыты — идёт раунд. Жди перерыва!"
		end
		local jackpot = state:GetAttribute("Jackpot") or 0
		bank.Text = string.format(
			"Банк ставок: %s 💰 (+25%%) • Джекпот: %s 💰",
			Config.Format(total),
			Config.Format(jackpot)
		)
	end

	hud.RegisterPanel("Bets", frame, close, function()
		rebuild()
		refreshInfo()
	end)
	hud.AddMenuButton("bets", "🎲", "Ставки", Color3.fromRGB(255, 160, 40), 1, function()
		hud.OpenPanel("Bets")
	end)

	Net.Event("BetUpdate").OnClientEvent:Connect(function(newPools, newMine, newTotal)
		pools = newPools or {}
		mine = newMine or {}
		total = newTotal or 0
		if frame.Visible then
			rebuild()
		end
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
	task.spawn(function()
		while true do
			if frame.Visible then
				refreshInfo()
			end
			task.wait(0.25)
		end
	end)
	-- автоматически подсказываем про ставки в начале перерыва
	state:GetAttributeChangedSignal("BetsOpen"):Connect(function()
		if frame.Visible then
			rebuild()
		end
	end)
end

return Bets
