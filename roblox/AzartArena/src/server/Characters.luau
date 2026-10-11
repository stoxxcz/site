-- Табличка с рангом над головой и купленный след за персонажем.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Data = require(script.Parent.Data)
local Util = require(script.Parent.Util)

local Characters = {}

local function updateTag(player: Player)
	local character = player.Character
	local head = character and character:FindFirstChild("Head")
	if not character or not head then
		return
	end
	local profile = Data.Get(player)
	local tag = head:FindFirstChild("RankTag")
	if not tag then
		-- свой ник + ранг вместо стандартной подписи Roblox
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		end
		tag = Util.Make("BillboardGui", {
			Name = "RankTag",
			Size = UDim2.fromOffset(240, 50),
			StudsOffset = Vector3.new(0, 2.8, 0),
			MaxDistance = 100,
			LightInfluence = 0,
			Parent = head,
		})
		local nameLabel = Util.Make("TextLabel", {
			Name = "PlayerName",
			Size = UDim2.fromScale(1, 0.52),
			BackgroundTransparency = 1,
			TextScaled = true,
			Font = Enum.Font.GothamBlack,
			TextColor3 = Color3.new(1, 1, 1),
			Text = player.DisplayName,
			Parent = tag,
		})
		Util.Make("UIStroke", { Thickness = 2, Color = Color3.new(0, 0, 0), Parent = nameLabel })
		local label = Util.Make("TextLabel", {
			Name = "Label",
			Size = UDim2.fromScale(1, 0.44),
			Position = UDim2.fromScale(0, 0.56),
			BackgroundTransparency = 1,
			TextScaled = true,
			Font = Enum.Font.GothamBlack,
			TextColor3 = Color3.new(1, 1, 1),
			Parent = tag,
		})
		Util.Make("UIStroke", { Thickness = 2, Color = Color3.new(0, 0, 0), Parent = label })
	end
	local label = (tag :: Instance):FindFirstChild("Label") :: TextLabel?
	if label then
		local coins = profile and profile.Coins or 0
		local wins = profile and profile.Wins or 0
		local rank = Config.GetRank(coins)
		label.Text = string.format("%s %s  🏆%d", rank.Icon, rank.Name, wins)
		label.TextColor3 = rank.Color
	end
end

local function applyTrail(player: Player)
	local root = Util.GetRoot(player)
	if not root then
		return
	end
	for _, name in { "AzTrail", "AzTrailA0", "AzTrailA1", "AzSparkles" } do
		local old = root:FindFirstChild(name)
		if old then
			old:Destroy()
		end
	end
	local profile = Data.Get(player)
	if not profile or profile.Equipped == "" then
		return
	end
	local item = Config.GetTrail(profile.Equipped)
	if not item then
		return
	end
	local a0 = Util.Make("Attachment", { Name = "AzTrailA0", Position = Vector3.new(0, 0.9, 0), Parent = root })
	local a1 = Util.Make("Attachment", { Name = "AzTrailA1", Position = Vector3.new(0, -0.9, 0), Parent = root })
	Util.Make("Trail", {
		Name = "AzTrail",
		Attachment0 = a0,
		Attachment1 = a1,
		Color = Config.ColorSequenceFrom(item.Colors),
		Lifetime = 0.7,
		MinLength = 0.05,
		LightEmission = 0.7,
		Transparency = NumberSequence.new(0.1, 1),
		WidthScale = NumberSequence.new(1, 0.3),
		Parent = root,
	})
	if item.Sparkles then
		Util.Make("Sparkles", { Name = "AzSparkles", SparkleColor = item.Colors[1], Parent = root })
	end
end

local function onCharacter(player: Player, character: Model)
	player:SetAttribute("InRound", false)
	local humanoid = character:WaitForChild("Humanoid", 10)
	character:WaitForChild("Head", 10)
	character:WaitForChild("HumanoidRootPart", 10)
	if not humanoid or character.Parent == nil then
		return
	end
	Data.WaitFor(player, 15)
	updateTag(player)
	applyTrail(player)
end

local function onPlayer(player: Player)
	player.CharacterAdded:Connect(function(character)
		onCharacter(player, character)
	end)
	if player.Character then
		task.spawn(onCharacter, player, player.Character)
	end
end

function Characters.Init()
	Players.RespawnTime = 3
	Players.PlayerAdded:Connect(onPlayer)
	for _, player in Players:GetPlayers() do
		onPlayer(player)
	end
	Data.Changed:Connect(function(player: Player, field: string)
		if field == "Coins" or field == "Wins" then
			updateTag(player)
		elseif field == "Equipped" then
			applyTrail(player)
		end
	end)
	Data.Loaded:Connect(function(player: Player)
		updateTag(player)
		applyTrail(player)
	end)
end

return Characters
