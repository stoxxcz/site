-- 🎨 Цветной пол: называется цвет, все остальные плитки исчезают. С каждым разом быстрее.

local Util = require(script.Parent.Parent.Util)

local COLORS = {
	{ Name = "🟥 КРАСНЫЙ", Color = Color3.fromRGB(235, 50, 50) },
	{ Name = "🟦 СИНИЙ", Color = Color3.fromRGB(40, 110, 255) },
	{ Name = "🟩 ЗЕЛЁНЫЙ", Color = Color3.fromRGB(40, 200, 80) },
	{ Name = "🟨 ЖЁЛТЫЙ", Color = Color3.fromRGB(255, 215, 40) },
	{ Name = "🟪 ФИОЛЕТОВЫЙ", Color = Color3.fromRGB(160, 60, 230) },
	{ Name = "🟧 ОРАНЖЕВЫЙ", Color = Color3.fromRGB(255, 130, 30) },
}
local GRID = 12
local TILE = 6

type Tile = { Part: BasePart, Color: number }

local ColorFloor = {
	Id = "ColorFloor",
	Title = "🎨 Цветной пол",
	Description = "Беги на плитку названного цвета — остальные исчезнут!",
	Mode = "survival",
	Duration = 110,
}

local function paint(tiles: { Tile }, pick: number?)
	repeat
		local count = 0
		for _, tile in tiles do
			tile.Color = math.random(#COLORS)
			if tile.Color == pick then
				count += 1
			end
		end
	until pick == nil or count >= 8
	for _, tile in tiles do
		tile.Part.Color = COLORS[tile.Color].Color
		tile.Part.Transparency = 0
		tile.Part.CanCollide = true
	end
end

function ColorFloor.Build(ctx)
	local origin: Vector3 = ctx.Origin
	local tiles: { Tile } = {}
	local half = (GRID + 1) / 2
	for x = 1, GRID do
		for z = 1, GRID do
			local part = Util.Part({
				Name = "Tile",
				Size = Vector3.new(TILE - 0.15, 1, TILE - 0.15),
				Position = origin + Vector3.new((x - half) * TILE, -0.5, (z - half) * TILE),
				Material = Enum.Material.SmoothPlastic,
				Parent = ctx.Folder,
			})
			table.insert(tiles, { Part = part, Color = 1 })
		end
	end

	local pillars = {}
	local edge = GRID * TILE / 2 + 5
	for _, corner in { Vector2.new(1, 1), Vector2.new(-1, 1), Vector2.new(1, -1), Vector2.new(-1, -1) } do
		local pillar = Util.Part({
			Name = "ColorPillar",
			Size = Vector3.new(4, 40, 4),
			Position = origin + Vector3.new(corner.X * edge, 5, corner.Y * edge),
			Material = Enum.Material.Neon,
			Color = Color3.new(1, 1, 1),
			Parent = ctx.Folder,
		})
		Util.Make("PointLight", { Range = 40, Brightness = 2, Parent = pillar })
		table.insert(pillars, pillar)
	end

	paint(tiles, nil)
	ctx.Data.Tiles = tiles
	ctx.Data.Pillars = pillars
	ctx.KillY = origin.Y - 40

	local spawns = {}
	for i = 1, 16 do
		spawns[i] = CFrame.new(origin + Vector3.new(math.random(-28, 28), 4, math.random(-28, 28)))
	end
	return spawns
end

function ColorFloor.Run(ctx)
	local tiles: { Tile } = ctx.Data.Tiles
	local pillars: { BasePart } = ctx.Data.Pillars
	local waitTime = 4.5
	task.wait(1.5)
	while not ctx.Ended do
		local pick = math.random(#COLORS)
		paint(tiles, pick)
		for _, pillar in pillars do
			pillar.Color = COLORS[pick].Color
			local light = pillar:FindFirstChildOfClass("PointLight")
			if light then
				light.Color = COLORS[pick].Color
			end
		end
		ctx:Announce(COLORS[pick].Name, COLORS[pick].Color, waitTime)
		task.wait(waitTime)
		if ctx.Ended then
			break
		end
		for _, tile in tiles do
			if tile.Color ~= pick then
				tile.Part.Transparency = 1
				tile.Part.CanCollide = false
			end
		end
		task.wait(2.5)
		waitTime = math.max(1.4, waitTime - 0.35)
	end
end

return ColorFloor
