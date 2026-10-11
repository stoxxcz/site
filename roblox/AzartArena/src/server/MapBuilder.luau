-- Строит лобби-казино: пол, стены, слоты, рулетку, стойки, табло, освещение.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Util = require(script.Parent.Util)

local MapBuilder = {}

local DARK = Color3.fromRGB(26, 20, 40)
local GOLD = Color3.fromRGB(255, 200, 60)
local PINK = Color3.fromRGB(255, 60, 170)
local CYAN = Color3.fromRGB(40, 220, 255)

export type SlotMachine = {
	Config: any,
	Prompt: ProximityPrompt,
	ReelsLabel: TextLabel,
	Top: BasePart,
	Model: Model,
}

export type Map = {
	Folder: Folder,
	SlotMachines: { SlotMachine },
	RouletteLabel: TextLabel,
	LeaderboardLabel: TextLabel,
	FeedLabel: TextLabel,
}

local function addStroke(label: TextLabel, thickness: number?)
	Util.Make("UIStroke", {
		Thickness = thickness or 3,
		Color = Color3.new(0, 0, 0),
		Transparency = 0.2,
		Parent = label,
	})
end

local function surfaceText(part: BasePart, text: string, color: Color3, pixelsPerStud: number?): TextLabel
	local gui = Util.Make("SurfaceGui", {
		Face = Enum.NormalId.Front,
		SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud,
		PixelsPerStud = pixelsPerStud or 20,
		LightInfluence = 0,
		Parent = part,
	})
	local label = Util.Make("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Text = text,
		TextScaled = true,
		RichText = true,
		Font = Enum.Font.GothamBlack,
		TextColor3 = color,
		Parent = gui,
	})
	Util.Make("UIPadding", {
		PaddingLeft = UDim.new(0.03, 0),
		PaddingRight = UDim.new(0.03, 0),
		PaddingTop = UDim.new(0.06, 0),
		PaddingBottom = UDim.new(0.06, 0),
		Parent = label,
	})
	addStroke(label)
	return label
end

local function sign(parent: Instance, cf: CFrame, size: Vector3, text: string, color: Color3, glow: Color3?): TextLabel
	local part = Util.Part({
		Name = "Sign",
		Size = size,
		CFrame = cf,
		Color = DARK,
		Material = Enum.Material.SmoothPlastic,
		Parent = parent,
	})
	-- неоновая рамка позади
	Util.Part({
		Name = "SignGlow",
		Size = Vector3.new(size.X + 1, size.Y + 1, 0.3),
		CFrame = cf * CFrame.new(0, 0, size.Z / 2 + 0.2),
		Color = glow or color,
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = parent,
	})
	return surfaceText(part, text, color)
end

local function prompt(parent: Instance, action: string, objectText: string, panel: string?): ProximityPrompt
	local p = Util.Make("ProximityPrompt", {
		ActionText = action,
		ObjectText = objectText,
		HoldDuration = 0,
		MaxActivationDistance = 11,
		RequiresLineOfSight = false,
		KeyboardKeyCode = Enum.KeyCode.E,
		Parent = parent,
	})
	if panel then
		p:SetAttribute("OpenPanel", panel)
	end
	return p
end

local function setupLighting()
	Lighting.ClockTime = 17.8
	Lighting.Brightness = 2.5
	Lighting.Ambient = Color3.fromRGB(70, 50, 90)
	Lighting.OutdoorAmbient = Color3.fromRGB(130, 110, 150)
	Lighting.EnvironmentDiffuseScale = 0.5
	Lighting.EnvironmentSpecularScale = 0.5

	for _, child in Lighting:GetChildren() do
		if child:IsA("PostEffect") or child:IsA("Atmosphere") then
			child:Destroy()
		end
	end
	Util.Make("BloomEffect", { Intensity = 0.8, Size = 28, Threshold = 0.95, Parent = Lighting })
	Util.Make("ColorCorrectionEffect", {
		Saturation = 0.2,
		Contrast = 0.08,
		TintColor = Color3.fromRGB(255, 245, 255),
		Parent = Lighting,
	})
	Util.Make("Atmosphere", {
		Density = 0.28,
		Offset = 0.1,
		Color = Color3.fromRGB(200, 160, 220),
		Decay = Color3.fromRGB(90, 60, 120),
		Glare = 0.4,
		Haze = 1.2,
		Parent = Lighting,
	})
end

local function buildShell(folder: Folder)
	-- пол-ковёр
	Util.Part({
		Name = "Floor",
		Size = Vector3.new(220, 4, 220),
		Position = Vector3.new(0, -2, 0),
		Color = Color3.fromRGB(80, 18, 40),
		Material = Enum.Material.Fabric,
		Parent = folder,
	})
	-- золотые полосы на полу
	for _, data in {
		{ Vector3.new(120, 0.2, 1), Vector3.new(0, 0.1, -60) },
		{ Vector3.new(120, 0.2, 1), Vector3.new(0, 0.1, 60) },
		{ Vector3.new(1, 0.2, 120), Vector3.new(-60, 0.1, 0) },
		{ Vector3.new(1, 0.2, 120), Vector3.new(60, 0.1, 0) },
	} do
		Util.Part({
			Name = "FloorLine",
			Size = data[1],
			Position = data[2],
			Color = GOLD,
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = folder,
		})
	end
	-- стены
	for _, data in {
		{ Vector3.new(224, 14, 2), Vector3.new(0, 7, -111) },
		{ Vector3.new(224, 14, 2), Vector3.new(0, 7, 111) },
		{ Vector3.new(2, 14, 224), Vector3.new(-111, 7, 0) },
		{ Vector3.new(2, 14, 224), Vector3.new(111, 7, 0) },
	} do
		Util.Part({
			Name = "Wall",
			Size = data[1],
			Position = data[2],
			Color = DARK,
			Material = Enum.Material.SmoothPlastic,
			Parent = folder,
		})
		Util.Part({
			Name = "WallNeon",
			Size = data[1] * Vector3.new(1, 0, 1) + Vector3.new(0.4, 0.8, 0.4),
			Position = data[2] + Vector3.new(0, 7.4, 0),
			Color = PINK,
			Material = Enum.Material.Neon,
			Parent = folder,
		})
	end
	-- угловые колонны со светом
	for _, corner in { Vector3.new(-100, 0, -100), Vector3.new(100, 0, -100), Vector3.new(-100, 0, 100), Vector3.new(100, 0, 100) } do
		local pillar = Util.Part({
			Name = "Pillar",
			Size = Vector3.new(5, 40, 5),
			Position = corner + Vector3.new(0, 20, 0),
			Color = CYAN,
			Material = Enum.Material.Neon,
			Parent = folder,
		})
		Util.Make("PointLight", { Color = CYAN, Range = 50, Brightness = 2, Parent = pillar })
	end
	-- спавн
	local spawnLocation = Instance.new("SpawnLocation")
	spawnLocation.Name = "LobbySpawn"
	spawnLocation.Anchored = true
	spawnLocation.Size = Vector3.new(16, 1, 16)
	spawnLocation.Position = Vector3.new(Config.LobbySpawn.X, 0.5, Config.LobbySpawn.Z)
	spawnLocation.Color = GOLD
	spawnLocation.Material = Enum.Material.SmoothPlastic
	spawnLocation.Neutral = true
	spawnLocation.Duration = 0
	spawnLocation.TopSurface = Enum.SurfaceType.Smooth
	spawnLocation.Parent = folder

	-- большая вращающаяся монета над центром
	local coin = Util.Part({
		Name = "BigCoin",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(1.5, 14, 14),
		CFrame = CFrame.new(0, 26, -20) * CFrame.Angles(0, 0, 0),
		Color = GOLD,
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = folder,
	})
	coin:SetAttribute("Spin", 1.2)
	Util.Make("PointLight", { Color = GOLD, Range = 40, Brightness = 2, Parent = coin })
	Util.Make("Sparkles", { SparkleColor = GOLD, Parent = coin })

	-- батуты
	for _, pos in { Vector3.new(-70, 0, 70), Vector3.new(70, 0, 70), Vector3.new(-70, 0, -40), Vector3.new(70, 0, -40) } do
		local pad = Util.Part({
			Name = "JumpPad",
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(1, 10, 10),
			CFrame = CFrame.new(pos + Vector3.new(0, 0.5, 0)) * CFrame.Angles(0, 0, math.rad(90)),
			Color = Color3.fromRGB(80, 255, 120),
			Material = Enum.Material.Neon,
			Parent = folder,
		})
		local debounce: { [Player]: number } = {}
		pad.Touched:Connect(function(hit)
			local player = Util.PlayerFromHit(hit)
			if not player then
				return
			end
			local now = os.clock()
			if (debounce[player] or 0) > now then
				return
			end
			debounce[player] = now + 1
			Net.Event("Knockback"):FireClient(player, Vector3.new(0, 140, 0), 0)
		end)
	end
end

local function buildSlotMachine(parent: Instance, pos: Vector3, facing: Vector3, cfg): SlotMachine
	local model = Instance.new("Model")
	model.Name = "Slot_" .. cfg.Id
	local base = CFrame.lookAt(pos, pos + facing)
	local body = cfg.Color:Lerp(Color3.new(0, 0, 0), 0.6)

	local cabinet = Util.Part({
		Name = "Cabinet",
		Size = Vector3.new(8, 10, 5),
		CFrame = base * CFrame.new(0, 5, 0),
		Color = body,
		Material = Enum.Material.SmoothPlastic,
		Parent = model,
	})
	for _, x in { -4.15, 4.15 } do
		Util.Part({
			Name = "Strip",
			Size = Vector3.new(0.3, 10, 5.2),
			CFrame = base * CFrame.new(x, 5, 0),
			Color = cfg.Color,
			Material = Enum.Material.Neon,
			Parent = model,
		})
	end
	local top = Util.Part({
		Name = "Top",
		Size = Vector3.new(8.6, 2.6, 5.4),
		CFrame = base * CFrame.new(0, 11.3, 0),
		Color = cfg.Color,
		Material = Enum.Material.Neon,
		Parent = model,
	})
	Util.Make("PointLight", { Color = cfg.Color, Range = 16, Brightness = 1.5, Parent = top })

	local topPanel = Util.Part({
		Name = "TopPanel",
		Size = Vector3.new(8, 2.2, 0.2),
		CFrame = base * CFrame.new(0, 11.3, -2.8),
		Color = DARK,
		Parent = model,
	})
	surfaceText(topPanel, cfg.Name .. " • " .. Config.Format(cfg.Stake) .. " 💰", Color3.new(1, 1, 1), 30)

	local screen = Util.Part({
		Name = "Screen",
		Size = Vector3.new(6.6, 3.6, 0.3),
		CFrame = base * CFrame.new(0, 7, -2.6),
		Color = Color3.fromRGB(8, 8, 14),
		Parent = model,
	})
	local reels = surfaceText(screen, "🍒 🔔 👑", Color3.new(1, 1, 1), 40)

	local lines = {}
	for i = #Config.Slots.Symbols, 1, -1 do
		local s = Config.Slots.Symbols[i]
		table.insert(lines, string.format("%s%s%s  x%d", s.Icon, s.Icon, s.Icon, s.Triple))
	end
	local payText = table.concat(lines, "   ", 1, 2)
		.. "\n"
		.. table.concat(lines, "   ", 3, 4)
		.. "\n"
		.. table.concat(lines, "   ", 5, 6)
		.. "\nДва одинаковых — возврат ставки"
	local payPanel = Util.Part({
		Name = "PayTable",
		Size = Vector3.new(6.6, 3.6, 0.3),
		CFrame = base * CFrame.new(0, 2.9, -2.6),
		Color = Color3.fromRGB(14, 10, 24),
		Parent = model,
	})
	surfaceText(payPanel, payText, GOLD, 40)

	-- рычаг
	Util.Part({
		Name = "LeverStick",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(4, 0.5, 0.5),
		CFrame = base * CFrame.new(4.7, 7.5, 0) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(200, 200, 210),
		Material = Enum.Material.Metal,
		Parent = model,
	})
	Util.Part({
		Name = "LeverBall",
		Shape = Enum.PartType.Ball,
		Size = Vector3.new(1.4, 1.4, 1.4),
		CFrame = base * CFrame.new(4.7, 9.6, 0),
		Color = Color3.fromRGB(255, 40, 60),
		Material = Enum.Material.Neon,
		Parent = model,
	})

	local p = prompt(cabinet, "Крутить", string.format("Слоты %s: ставка %s", cfg.Name, Config.Format(cfg.Stake)))
	p:SetAttribute("MachineId", cfg.Id)

	model.Parent = parent
	return {
		Config = cfg,
		Prompt = p,
		ReelsLabel = reels,
		Top = top,
		Model = model,
	}
end

local function buildRoulette(parent: Folder): TextLabel
	local folder = Instance.new("Folder")
	folder.Name = "Roulette"

	local center = Vector3.new(-95, 18, 0)
	local base = CFrame.lookAt(center, center + Vector3.new(1, 0, 0))
	local radius = 12
	local segments = Config.Roulette.Segments
	local count = #segments
	local segAngle = math.pi * 2 / count

	local wheel = Instance.new("Model")
	wheel.Name = "Wheel"
	wheel:SetAttribute("Base", base)
	wheel:SetAttribute("Segments", count)

	-- задний диск (золотые разделители между секторами)
	Util.Part({
		Name = "Back",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.6, radius * 2 + 1.2, radius * 2 + 1.2),
		CFrame = base * CFrame.new(0, 0, 0.6) * CFrame.Angles(0, math.rad(90), 0),
		Color = GOLD,
		Material = Enum.Material.Metal,
		CanCollide = false,
		Parent = wheel,
	})
	local rMid = radius - 2
	local chord = 2 * rMid * math.sin(segAngle / 2)
	for i, colorId in segments do
		local theta = (i - 1) * segAngle
		-- соседние секторы разной толщины, чтобы не мерцали на стыках
		local thickness = if i == 1 then 1 elseif i % 2 == 0 then 0.8 else 0.9
		local tile = Util.Part({
			Name = "Segment" .. i,
			Size = Vector3.new(chord - 0.35, 4, thickness),
			CFrame = base * CFrame.Angles(0, 0, -theta) * CFrame.new(0, rMid, 0),
			Color = Config.Roulette.Colors[colorId].Color,
			Material = Enum.Material.SmoothPlastic,
			CanCollide = false,
			Parent = wheel,
		})
		tile:SetAttribute("Segment", i)
	end
	Util.Part({
		Name = "Hub",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(1, (rMid - 2) * 2 + 0.6, (rMid - 2) * 2 + 0.6),
		CFrame = base * CFrame.new(0, 0, -0.4) * CFrame.Angles(0, math.rad(90), 0),
		Color = Color3.fromRGB(60, 20, 30),
		Material = Enum.Material.SmoothPlastic,
		CanCollide = false,
		Parent = wheel,
	})
	-- спицы на хабе
	for i = 0, 3 do
		Util.Part({
			Name = "Spoke",
			Size = Vector3.new(0.5, (rMid - 2) * 2, 0.3),
			CFrame = base * CFrame.new(0, 0, -1) * CFrame.Angles(0, 0, i * math.pi / 4),
			Color = GOLD,
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = wheel,
		})
	end
	Util.Part({
		Name = "Cap",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.8, 3.5, 3.5),
		CFrame = base * CFrame.new(0, 0, -1.2) * CFrame.Angles(0, math.rad(90), 0),
		Color = GOLD,
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = wheel,
	})
	wheel.Parent = folder

	-- указатель (не вращается)
	local pointer = Util.Part({
		Name = "Pointer",
		Size = Vector3.new(2.4, 2.4, 1),
		CFrame = base * CFrame.new(0, radius + 1.1, -0.9) * CFrame.Angles(0, 0, math.rad(45)),
		Color = Color3.new(1, 1, 1),
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = folder,
	})
	Util.Make("PointLight", { Color = Color3.new(1, 1, 1), Range = 12, Parent = pointer })

	-- подставка
	Util.Part({
		Name = "Stand",
		Size = Vector3.new(3, center.Y, 5),
		Position = Vector3.new(center.X - 1.6, center.Y / 2, center.Z),
		Color = DARK,
		Parent = folder,
	})
	Util.Part({
		Name = "StandBase",
		Size = Vector3.new(8, 1, 14),
		Position = Vector3.new(center.X - 1.6, 0.5, center.Z),
		Color = GOLD,
		Material = Enum.Material.Metal,
		Parent = folder,
	})

	-- стол для ставок
	local tableTop = Util.Part({
		Name = "RouletteTable",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(1, 12, 12),
		CFrame = CFrame.new(-74, 3.5, 0) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(20, 110, 50),
		Material = Enum.Material.Fabric,
		Parent = folder,
	})
	Util.Part({
		Name = "TableRim",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.8, 12.8, 12.8),
		CFrame = CFrame.new(-74, 3.3, 0) * CFrame.Angles(0, 0, math.rad(90)),
		Color = GOLD,
		Material = Enum.Material.Neon,
		Parent = folder,
	})
	Util.Part({
		Name = "TableLeg",
		Size = Vector3.new(2, 3, 2),
		Position = Vector3.new(-74, 1.5, 0),
		Color = DARK,
		Parent = folder,
	})
	prompt(tableTop, "Сделать ставку", "🎡 Рулетка", "Roulette")

	-- табло над колесом
	local boardAnchor = Util.Part({
		Name = "BoardAnchor",
		Size = Vector3.new(1, 1, 1),
		Position = center + Vector3.new(0, radius + 6, 0),
		Transparency = 1,
		CanCollide = false,
		Parent = folder,
	})
	local billboard = Util.Make("BillboardGui", {
		Size = UDim2.fromOffset(360, 110),
		AlwaysOnTop = false,
		MaxDistance = 220,
		LightInfluence = 0,
		Parent = boardAnchor,
	})
	local label = Util.Make("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Text = "🎡 РУЛЕТКА",
		TextScaled = true,
		RichText = true,
		Font = Enum.Font.GothamBlack,
		TextColor3 = GOLD,
		Parent = billboard,
	})
	addStroke(label)

	folder.Parent = parent
	return label
end

local function buildBooth(parent: Instance, pos: Vector3, facing: Vector3, title: string, color: Color3, panel: string, action: string)
	local model = Instance.new("Model")
	model.Name = panel .. "Booth"
	local base = CFrame.lookAt(pos, pos + facing)

	local counter = Util.Part({
		Name = "Counter",
		Size = Vector3.new(14, 4, 3),
		CFrame = base * CFrame.new(0, 2, -2),
		Color = DARK,
		Parent = model,
	})
	Util.Part({
		Name = "CounterTop",
		Size = Vector3.new(14.4, 0.4, 3.4),
		CFrame = base * CFrame.new(0, 4.2, -2),
		Color = color,
		Material = Enum.Material.Neon,
		Parent = model,
	})
	Util.Part({
		Name = "BackWall",
		Size = Vector3.new(16, 12, 1),
		CFrame = base * CFrame.new(0, 6, 3),
		Color = color:Lerp(Color3.new(0, 0, 0), 0.65),
		Parent = model,
	})
	for _, x in { -7.5, 7.5 } do
		Util.Part({
			Name = "Post",
			Size = Vector3.new(1, 12, 1),
			CFrame = base * CFrame.new(x, 6, -2),
			Color = color,
			Material = Enum.Material.Neon,
			Parent = model,
		})
	end
	local roof = Util.Part({
		Name = "Roof",
		Size = Vector3.new(17, 1, 7),
		CFrame = base * CFrame.new(0, 12.5, 0.5),
		Color = DARK,
		Parent = model,
	})
	Util.Make("PointLight", { Color = color, Range = 18, Brightness = 1.5, Parent = roof })
	sign(model, base * CFrame.new(0, 15.5, -1), Vector3.new(16, 4.5, 0.5), title, Color3.new(1, 1, 1), color)
	prompt(counter, action, title, panel)
	model.Parent = parent
end

local function buildBoard(parent: Instance, cf: CFrame, title: string, color: Color3): TextLabel
	local size = Vector3.new(34, 24, 1)
	local part = Util.Part({
		Name = "Board",
		Size = size,
		CFrame = cf,
		Color = Color3.fromRGB(16, 12, 28),
		Parent = parent,
	})
	Util.Part({
		Name = "BoardGlow",
		Size = Vector3.new(size.X + 1.2, size.Y + 1.2, 0.3),
		CFrame = cf * CFrame.new(0, 0, 0.6),
		Color = color,
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = parent,
	})
	local gui = Util.Make("SurfaceGui", {
		Face = Enum.NormalId.Front,
		SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud,
		PixelsPerStud = 20,
		LightInfluence = 0,
		Parent = part,
	})
	local titleLabel = Util.Make("TextLabel", {
		Size = UDim2.new(1, 0, 0.16, 0),
		BackgroundTransparency = 1,
		Text = title,
		TextScaled = true,
		Font = Enum.Font.GothamBlack,
		TextColor3 = color,
		Parent = gui,
	})
	addStroke(titleLabel)
	local body = Util.Make("TextLabel", {
		Size = UDim2.new(1, -40, 0.8, 0),
		Position = UDim2.new(0, 20, 0.18, 0),
		BackgroundTransparency = 1,
		Text = "",
		TextSize = 30,
		TextWrapped = true,
		RichText = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		Font = Enum.Font.GothamBold,
		TextColor3 = Color3.new(1, 1, 1),
		Parent = gui,
	})
	return body
end

function MapBuilder.Build(): Map
	setupLighting()

	local old = workspace:FindFirstChild("Lobby")
	if old then
		old:Destroy()
	end
	local baseplate = workspace:FindFirstChild("Baseplate")
	if baseplate then
		baseplate:Destroy()
	end

	local folder = Instance.new("Folder")
	folder.Name = "Lobby"
	-- сначала оболочка со спавном, чтобы игроки сразу появлялись в лобби
	buildShell(folder)
	folder.Parent = workspace

	-- заголовок
	sign(
		folder,
		CFrame.lookAt(Vector3.new(0, 34, -108), Vector3.new(0, 34, 0)),
		Vector3.new(90, 18, 1),
		'🎰 <font color="#FFC83C">АЗАРТ</font> АРЕНА 🎰',
		Color3.new(1, 1, 1),
		PINK
	)

	-- слоты
	local casino = Instance.new("Folder")
	casino.Name = "Casino"
	local machines = {}
	for i, cfg in Config.Slots.Machines do
		local x = (i - 2) * 26
		table.insert(machines, buildSlotMachine(casino, Vector3.new(x, 0, -72), Vector3.new(0, 0, 1), cfg))
	end
	sign(
		casino,
		CFrame.lookAt(Vector3.new(0, 20, -78), Vector3.new(0, 20, 0)),
		Vector3.new(40, 5, 0.5),
		"🎰 СЛОТЫ — жми E у автомата",
		Color3.new(1, 1, 1),
		GOLD
	)
	casino.Parent = folder

	local rouletteLabel = buildRoulette(folder)

	buildBooth(folder, Vector3.new(-50, 0, 78), Vector3.new(0, 0, -1), "🎲 СТАВКИ НА РАУНД", Color3.fromRGB(255, 140, 0), "Bets", "Поставить")
	buildBooth(folder, Vector3.new(50, 0, 78), Vector3.new(0, 0, -1), "🪙 ДУЭЛИ В МОНЕТКУ", Color3.fromRGB(60, 200, 255), "Duel", "Вызвать")
	buildBooth(folder, Vector3.new(92, 0, 0), Vector3.new(-1, 0, 0), "🛒 МАГАЗИН СЛЕДОВ", Color3.fromRGB(180, 80, 255), "Shop", "Открыть")

	local boardZ = 109.4
	local leaderboard = buildBoard(
		folder,
		CFrame.lookAt(Vector3.new(-42, 16, boardZ), Vector3.new(-42, 16, 0)),
		"🏆 ТОП СЕРВЕРА",
		GOLD
	)
	local howTo = buildBoard(
		folder,
		CFrame.lookAt(Vector3.new(0, 16, boardZ), Vector3.new(0, 16, 0)),
		"❓ КАК ИГРАТЬ",
		CYAN
	)
	howTo.Text = table.concat({
		"🎮 Каждые ~2 минуты — раунд с мини-игрой.",
		"🎲 В перерыве ставь монеты на того, кто победит!",
		"🎰 Если никто не угадал — растёт ДЖЕКПОТ.",
		"🎡 Рулетка крутится каждые 30 секунд.",
		"🪙 Вызывай друзей на дуэль в монетку.",
		"🛒 Копи на крутые следы и ранги.",
		"💸 Банкрот? Возьми пособие в меню слева.",
	}, "\n")
	howTo.TextSize = 28
	local feed = buildBoard(
		folder,
		CFrame.lookAt(Vector3.new(42, 16, boardZ), Vector3.new(42, 16, 0)),
		"🔥 КРУПНЫЕ ВЫИГРЫШИ",
		PINK
	)
	feed.Text = "Пока пусто... стань первым!"

	return {
		Folder = folder,
		SlotMachines = machines,
		RouletteLabel = rouletteLabel,
		LeaderboardLabel = leaderboard,
		FeedLabel = feed,
	}
end

return MapBuilder
