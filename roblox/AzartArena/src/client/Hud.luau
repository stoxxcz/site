-- Основной интерфейс: статус раунда, джекпот, монеты, меню, уведомления, объявления.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Sounds = require(script.Parent.Sounds)
local UI = require(script.Parent.UI)

local player = Players.LocalPlayer
local state = Net.State()

local Hud = {}

type PanelInfo = { Frame: GuiObject, OnOpen: (() -> ())? }

local gui: ScreenGui
local scales: { UIScale } = {}
local panels: { [string]: PanelInfo } = {}
local openName: string? = nil
local menu: Frame
local toastHolder: Frame
local announceFrame: Frame
local announceLabel: TextLabel
local announceBar: Frame
local announceToken = 0
local menuButtons: { [string]: GuiButton } = {}

local function addScale(target: GuiObject)
	local scale = UI.new("UIScale", { Parent = target })
	table.insert(scales, scale)
end

local function rescale()
	local camera = Workspace.CurrentCamera
	if not camera then
		return
	end
	local viewport = camera.ViewportSize
	local value = math.clamp(math.min(viewport.X / 1200, viewport.Y / 760), 0.55, 1.1)
	for _, scale in scales do
		scale.Scale = value
	end
end

function Hud.Gui(): ScreenGui
	return gui
end

------------------------------------------------------------------------
-- Панели
------------------------------------------------------------------------

function Hud.RegisterPanel(name: string, frame: GuiObject, closeButton: GuiButton, onOpen: (() -> ())?)
	panels[name] = { Frame = frame, OnOpen = onOpen }
	addScale(frame)
	rescale()
	closeButton.Activated:Connect(function()
		Hud.ClosePanel()
	end)
end

function Hud.ClosePanel()
	for _, info in panels do
		info.Frame.Visible = false
	end
	openName = nil
end

function Hud.OpenPanel(name: string)
	local info = panels[name]
	if not info then
		return
	end
	if openName == name then
		Hud.ClosePanel()
		return
	end
	Hud.ClosePanel()
	openName = name
	info.Frame.Position = UDim2.fromScale(0.5, 0.56)
	info.Frame.Visible = true
	UI.Tween(info.Frame, 0.2, { Position = UDim2.fromScale(0.5, 0.5) }, Enum.EasingStyle.Back)
	Sounds.Play("Click", 0.4)
	if info.OnOpen then
		info.OnOpen()
	end
end

function Hud.IsOpen(name: string): boolean
	return openName == name
end

------------------------------------------------------------------------
-- Меню слева
------------------------------------------------------------------------

function Hud.AddMenuButton(id: string, icon: string, label: string, color: Color3, order: number, callback: () -> ()): GuiButton
	local button = UI.new("TextButton", {
		Name = id,
		Size = UDim2.fromOffset(78, 74),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.1,
		Text = "",
		AutoButtonColor = true,
		LayoutOrder = order,
		Parent = menu,
	}, {
		UI.Corner(14),
		UI.Stroke(color, 2.5),
	})
	UI.Label({
		Text = icon,
		Size = UDim2.new(1, 0, 0.62, 0),
		Position = UDim2.fromScale(0, 0.04),
		Parent = button,
	})
	UI.Label({
		Text = label,
		Size = UDim2.new(1, -6, 0.28, 0),
		Position = UDim2.new(0, 3, 0.66, 0),
		TextColor3 = color,
		Font = UI.FontBlack,
		Parent = button,
	})
	button.Activated:Connect(callback)
	menuButtons[id] = button
	return button
end

function Hud.SetMenuVisible(id: string, visible: boolean)
	local button = menuButtons[id]
	if button then
		button.Visible = visible
	end
end

------------------------------------------------------------------------
-- Уведомления и объявления
------------------------------------------------------------------------

local TOAST_COLORS = {
	info = UI.Colors.Panel2,
	success = Color3.fromRGB(30, 140, 70),
	error = Color3.fromRGB(150, 30, 45),
	bigwin = Color3.fromRGB(200, 120, 0),
	death = Color3.fromRGB(70, 20, 30),
}

function Hud.Toast(text: string, kind: string?)
	kind = kind or "info"
	local color = TOAST_COLORS[kind :: string] or TOAST_COLORS.info
	local toast = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, kind == "bigwin" and 40 or 32),
		BackgroundColor3 = color,
		BackgroundTransparency = 1,
		LayoutOrder = -math.floor(os.clock() * 100),
		Parent = toastHolder,
	}, {
		UI.Corner(10),
	})
	local stroke = UI.Stroke(kind == "bigwin" and UI.Colors.Accent or Color3.new(0, 0, 0), kind == "bigwin" and 2.5 or 1.5, 1)
	stroke.Parent = toast
	local label = UI.Label({
		Text = text,
		Size = UDim2.new(1, -16, 1, -8),
		Position = UDim2.fromOffset(8, 4),
		TextTransparency = 1,
		Parent = toast,
	})
	UI.Tween(toast, 0.2, { BackgroundTransparency = 0.12 })
	UI.Tween(label, 0.2, { TextTransparency = 0 })
	UI.Tween(stroke, 0.2, { Transparency = 0 })

	local children = {}
	for _, child in toastHolder:GetChildren() do
		if child:IsA("Frame") then
			table.insert(children, child)
		end
	end
	if #children > 4 then
		-- самое старое уведомление имеет наибольший LayoutOrder
		table.sort(children, function(a, b)
			return (a :: Frame).LayoutOrder > (b :: Frame).LayoutOrder
		end)
		children[1]:Destroy()
	end

	if kind == "bigwin" then
		Sounds.Play("Win", 0.5, 1.2)
	elseif kind == "success" then
		Sounds.Play("Coin", 0.35)
	elseif kind == "error" then
		Sounds.Play("Lose", 0.3)
	end

	task.delay(kind == "bigwin" and 6 or 4, function()
		if toast.Parent then
			UI.Tween(toast, 0.3, { BackgroundTransparency = 1 })
			UI.Tween(label, 0.3, { TextTransparency = 1 })
			UI.Tween(stroke, 0.3, { Transparency = 1 })
			task.wait(0.32)
			toast:Destroy()
		end
	end)
end

function Hud.Announce(text: string, color: Color3?, duration: number?)
	announceToken += 1
	local token = announceToken
	local time = duration or 2
	announceLabel.Text = text
	announceLabel.TextColor3 = color or UI.Colors.Accent
	announceFrame.Visible = true
	local scale = (announceFrame:FindFirstChild("Inner") :: Frame):FindFirstChild("Pop") :: UIScale
	scale.Scale = 0.5
	UI.Tween(scale, 0.25, { Scale = 1 }, Enum.EasingStyle.Back)
	if time >= 1.3 then
		announceBar.Visible = true
		announceBar.Size = UDim2.new(1, 0, 1, 0)
		UI.Tween(announceBar, time, { Size = UDim2.new(0, 0, 1, 0) }, Enum.EasingStyle.Linear)
	else
		announceBar.Visible = false
	end
	Sounds.Play("Tick", 0.4, 1.3)
	task.delay(time, function()
		if announceToken == token then
			announceFrame.Visible = false
		end
	end)
end

------------------------------------------------------------------------
-- Построение
------------------------------------------------------------------------

local function buildStatus()
	local bar = UI.new("Frame", {
		Name = "Status",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 6),
		Size = UDim2.fromOffset(500, 82),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.12,
		Parent = gui,
	}, {
		UI.Corner(14),
		UI.Stroke(UI.Colors.Pink, 2.5),
	})
	addScale(bar)
	local title = UI.Label({
		Size = UDim2.new(1, -20, 0, 34),
		Position = UDim2.fromOffset(10, 5),
		Font = UI.FontBlack,
		TextColor3 = UI.Colors.Accent,
		Text = "АЗАРТ АРЕНА",
		Parent = bar,
	})
	UI.TextStroke(2).Parent = title
	local sub = UI.Label({
		Size = UDim2.new(1, -20, 0, 22),
		Position = UDim2.fromOffset(10, 39),
		Text = "",
		Parent = bar,
	})
	local hint = UI.Label({
		Size = UDim2.new(1, -20, 0, 16),
		Position = UDim2.fromOffset(10, 62),
		TextColor3 = UI.Colors.Muted,
		Font = UI.Font,
		Text = "",
		Parent = bar,
	})

	local jackpot = UI.new("Frame", {
		Name = "Jackpot",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 94),
		Size = UDim2.fromOffset(250, 32),
		BackgroundColor3 = Color3.fromRGB(120, 60, 0),
		Parent = gui,
	}, {
		UI.Corner(16),
		UI.Stroke(UI.Colors.Accent, 2),
		UI.Gradient(Color3.fromRGB(255, 170, 0), Color3.fromRGB(170, 70, 0)),
	})
	addScale(jackpot)
	local jackpotLabel = UI.Label({
		Size = UDim2.new(1, -16, 1, -6),
		Position = UDim2.fromOffset(8, 3),
		Font = UI.FontBlack,
		Text = "🎰 ДЖЕКПОТ: 0",
		Parent = jackpot,
	})
	UI.TextStroke(1.5).Parent = jackpotLabel

	task.spawn(function()
		while true do
			local phase = state:GetAttribute("Phase") or "Waiting"
			local left = math.max(0, math.ceil((state:GetAttribute("EndsAt") or 0) - Net.Now()))
			local inRound = player:GetAttribute("InRound") == true
			if phase == "Waiting" then
				title.Text = "⌛ Ждём игроков..."
				sub.Text = "Пока можно поиграть в казино!"
				hint.Text = ""
			elseif phase == "Intermission" then
				title.Text = string.format("⏳ ПЕРЕРЫВ • %d", left)
				sub.Text = "Далее: " .. tostring(state:GetAttribute("Next") or "")
				hint.Text = "🎲 Ставь на победителя — кнопка «Ставки» слева"
			elseif phase == "Countdown" then
				title.Text = tostring(state:GetAttribute("Title") or "")
				sub.Text = tostring(state:GetAttribute("Desc") or "")
				hint.Text = "Приготовься!"
			elseif phase == "Playing" then
				title.Text = string.format("%s • %d", tostring(state:GetAttribute("Title") or ""), left)
				sub.Text = string.format("👥 В игре: %d / %d", state:GetAttribute("Alive") or 0, state:GetAttribute("Total") or 0)
				hint.Text = inRound and tostring(state:GetAttribute("Desc") or "") or "👁 Ты зритель — жми «Смотреть» или крути слоты"
			elseif phase == "Results" then
				title.Text = "🏆 ИТОГИ РАУНДА"
				sub.Text = "Скоро следующий раунд"
				hint.Text = ""
			end
			jackpotLabel.Text = "🎰 ДЖЕКПОТ: " .. Config.Format(state:GetAttribute("Jackpot") or 0) .. " 💰"
			task.wait(0.2)
		end
	end)
end

local function buildCoins()
	local frame = UI.new("Frame", {
		Name = "Coins",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -10),
		Size = UDim2.fromOffset(270, 64),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.1,
		Parent = gui,
	}, {
		UI.Corner(16),
		UI.Stroke(UI.Colors.Accent, 3),
	})
	addScale(frame)
	local amount = UI.Label({
		Size = UDim2.new(1, -20, 0, 38),
		Position = UDim2.fromOffset(10, 4),
		Font = UI.FontBlack,
		TextColor3 = UI.Colors.Accent,
		Text = "💰 0",
		Parent = frame,
	})
	UI.TextStroke(2).Parent = amount
	local rank = UI.Label({
		Size = UDim2.new(1, -20, 0, 18),
		Position = UDim2.fromOffset(10, 42),
		Text = "",
		Parent = frame,
	})

	local shown = player:GetAttribute("Coins") or 0
	local function refresh()
		local coins = player:GetAttribute("Coins") or 0
		local delta = coins - shown
		shown = coins
		amount.Text = "💰 " .. Config.Format(coins)
		local r = Config.GetRank(coins)
		rank.Text = string.format("%s %s • 🏆 %d", r.Icon, r.Name, player:GetAttribute("Wins") or 0)
		rank.TextColor3 = r.Color
		Hud.SetMenuVisible("welfare", coins < Config.Welfare.Threshold)
		if delta ~= 0 then
			local float = UI.Label({
				Text = (delta > 0 and "+" or "") .. Config.Format(delta),
				TextColor3 = delta > 0 and UI.Colors.Good or UI.Colors.Bad,
				Font = UI.FontBlack,
				AnchorPoint = Vector2.new(0.5, 1),
				Position = UDim2.new(0.5, math.random(-60, 60), 0, -4),
				Size = UDim2.fromOffset(200, 30),
				Parent = frame,
			})
			UI.TextStroke(2).Parent = float
			UI.Tween(float, 1.2, { Position = float.Position - UDim2.fromOffset(0, 50), TextTransparency = 1 })
			task.delay(1.25, function()
				float:Destroy()
			end)
			local pop = frame:FindFirstChildOfClass("UIScale")
			if pop and delta > 0 then
				local base = pop.Scale
				pop.Scale = base * 1.08
				UI.Tween(pop, 0.25, { Scale = base })
			end
		end
	end
	player:GetAttributeChangedSignal("Coins"):Connect(refresh)
	player:GetAttributeChangedSignal("Wins"):Connect(refresh)
	task.defer(refresh)
end

local function buildMenu()
	menu = UI.new("Frame", {
		Name = "Menu",
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, 10, 0.5, 0),
		Size = UDim2.fromOffset(78, 520),
		BackgroundTransparency = 1,
		Parent = gui,
	}, {
		UI.new("UIListLayout", {
			Padding = UDim.new(0, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
			VerticalAlignment = Enum.VerticalAlignment.Center,
		}),
	})
	addScale(menu)
	local welfare = Hud.AddMenuButton("welfare", "💸", "Пособие", UI.Colors.Good, 100, function()
		Net.Event("ClaimWelfare"):FireServer()
	end)
	welfare.Visible = false
end

local function buildToasts()
	toastHolder = UI.new("Frame", {
		Name = "Toasts",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 134),
		Size = UDim2.fromOffset(520, 200),
		BackgroundTransparency = 1,
		Parent = gui,
	}, {
		UI.new("UIListLayout", {
			Padding = UDim.new(0, 5),
			SortOrder = Enum.SortOrder.LayoutOrder,
			VerticalAlignment = Enum.VerticalAlignment.Top,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
		}),
	})
	addScale(toastHolder)
end

local function buildAnnounce()
	announceFrame = UI.new("Frame", {
		Name = "Announce",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.46),
		Size = UDim2.fromOffset(760, 110),
		BackgroundTransparency = 1,
		Visible = false,
		ZIndex = 3,
		Parent = gui,
	})
	addScale(announceFrame)
	-- внутренняя рамка с собственным UIScale для эффекта «выпрыгивания»
	local inner = UI.new("Frame", {
		Name = "Inner",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		ZIndex = 3,
		Parent = announceFrame,
	})
	UI.new("UIScale", { Name = "Pop", Parent = inner })
	announceLabel = UI.Label({
		Size = UDim2.new(1, 0, 0, 90),
		Font = UI.FontBlack,
		ZIndex = 3,
		Text = "",
		Parent = inner,
	})
	UI.TextStroke(4).Parent = announceLabel
	local barBg = UI.new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 96),
		Size = UDim2.fromOffset(320, 10),
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 0.4,
		ZIndex = 3,
		Parent = inner,
	}, {
		UI.Corner(5),
	})
	announceBar = UI.new("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.new(1, 1, 1),
		ZIndex = 3,
		Parent = barBg,
	}, {
		UI.Corner(5),
	})
end

function Hud.Init()
	gui = UI.new("ScreenGui", {
		Name = "AzartHUD",
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Parent = player:WaitForChild("PlayerGui"),
	})
	buildStatus()
	buildMenu()
	buildCoins()
	buildToasts()
	buildAnnounce()

	rescale()
	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
	end

	Net.Event("Notify").OnClientEvent:Connect(function(text: string, kind: string?)
		Hud.Toast(text, kind)
	end)
	Net.Event("Announce").OnClientEvent:Connect(function(text: string, color: Color3?, duration: number?)
		Hud.Announce(text, color, duration)
	end)
end

return Hud
