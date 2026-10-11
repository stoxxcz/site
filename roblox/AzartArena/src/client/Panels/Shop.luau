-- Магазин следов.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local UI = require(script.Parent.Parent.UI)

local player = Players.LocalPlayer

local Shop = {}

local owned: { [string]: boolean } = {}
local equipped = ""

function Shop.Init(hud)
	local accent = Color3.fromRGB(180, 80, 255)
	local frame, content, close = UI.Panel(hud.Gui(), "🛒 МАГАЗИН СЛЕДОВ", UDim2.fromOffset(520, 540), accent)

	local list = UI.new("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -50),
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
	local unequip = UI.Button("Снять след", UI.Colors.Panel2, {
		Size = UDim2.new(1, 0, 0, 40),
		Position = UDim2.new(0, 0, 1, -42),
		ZIndex = 6,
		Parent = content,
	})
	unequip.Activated:Connect(function()
		Net.Event("ShopAction"):FireServer("equip", "")
	end)

	local function rebuild()
		for _, child in list:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local coins = player:GetAttribute("Coins") or 0
		for i, item in Config.Trails do
			local row = UI.new("Frame", {
				Size = UDim2.new(1, -4, 0, 62),
				BackgroundColor3 = UI.Colors.Panel2,
				LayoutOrder = i,
				ZIndex = 6,
				Parent = list,
			}, {
				UI.Corner(10),
			})
			UI.new("Frame", {
				Size = UDim2.fromOffset(84, 44),
				Position = UDim2.fromOffset(9, 9),
				BackgroundColor3 = Color3.new(1, 1, 1),
				ZIndex = 7,
				Parent = row,
			}, {
				UI.Corner(10),
				UI.new("UIGradient", { Color = Config.ColorSequenceFrom(item.Colors) }),
			})
			UI.Label({
				Text = item.Name .. " след" .. (item.Sparkles and " ✨" or ""),
				Size = UDim2.new(1, -250, 0, 26),
				Position = UDim2.fromOffset(104, 6),
				TextXAlignment = Enum.TextXAlignment.Left,
				Font = UI.FontBlack,
				ZIndex = 7,
				Parent = row,
			})
			UI.Label({
				Text = "💰 " .. Config.Format(item.Price),
				Size = UDim2.new(1, -250, 0, 20),
				Position = UDim2.fromOffset(104, 34),
				TextXAlignment = Enum.TextXAlignment.Left,
				TextColor3 = UI.Colors.Accent,
				ZIndex = 7,
				Parent = row,
			})
			local text, color, action
			if equipped == item.Id then
				text, color, action = "✔ Надет", UI.Colors.Panel, nil
			elseif owned[item.Id] then
				text, color, action = "Надеть", UI.Colors.Cyan, "equip"
			elseif coins >= item.Price then
				text, color, action = "Купить", UI.Colors.Good, "buy"
			else
				text, color, action = "Мало 💰", UI.Colors.Bad, "buy"
			end
			local button = UI.Button(text, color, {
				Size = UDim2.fromOffset(130, 42),
				Position = UDim2.new(1, -138, 0, 10),
				ZIndex = 7,
				Parent = row,
			})
			button.Activated:Connect(function()
				if action then
					Net.Event("ShopAction"):FireServer(action, item.Id)
				end
			end)
		end
	end

	Net.Event("ShopState").OnClientEvent:Connect(function(ownedList, newEquipped)
		owned = {}
		for _, id in ownedList or {} do
			owned[id] = true
		end
		equipped = newEquipped or ""
		if frame.Visible then
			rebuild()
		end
	end)
	player:GetAttributeChangedSignal("Coins"):Connect(function()
		if frame.Visible then
			rebuild()
		end
	end)

	hud.RegisterPanel("Shop", frame, close, rebuild)
	hud.AddMenuButton("shop", "🛒", "Магазин", accent, 4, function()
		hud.OpenPanel("Shop")
	end)
end

return Shop
