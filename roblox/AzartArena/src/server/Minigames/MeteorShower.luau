-- ☄️ Метеоритный дождь: метеориты целятся в игроков и выбивают куски арены.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Net = require(ReplicatedStorage.Shared.Net)
local Util = require(script.Parent.Parent.Util)

local GRID = 14
local TILE = 6
local KILL_RADIUS = 6.5
local PUSH_RADIUS = 13
local FALL_TIME = 1.3

local MeteorShower = {
	Id = "MeteorShower",
	Title = "☄️ Метеоритный дождь",
	Description = "Уворачивайся от метеоритов! Красный круг — сюда сейчас прилетит.",
	Mode = "survival",
	Duration = 90,
}

function MeteorShower.Build(ctx)
	local origin: Vector3 = ctx.Origin
	local tiles: { BasePart } = {}
	local half = (GRID + 1) / 2
	for x = 1, GRID do
		for z = 1, GRID do
			local shade = ((x + z) % 2 == 0) and Color3.fromRGB(70, 60, 90) or Color3.fromRGB(55, 45, 75)
			table.insert(
				tiles,
				Util.Part({
					Name = "Tile",
					Size = Vector3.new(TILE, 1, TILE),
					Position = origin + Vector3.new((x - half) * TILE, -0.5, (z - half) * TILE),
					Color = shade,
					Material = Enum.Material.Slate,
					Parent = ctx.Folder,
				})
			)
		end
	end
	ctx.Data.Tiles = tiles
	ctx.KillY = origin.Y - 30

	local spawns = {}
	for i = 1, 16 do
		spawns[i] = CFrame.new(origin + Vector3.new(math.random(-32, 32), 4, math.random(-32, 32)))
	end
	return spawns
end

local function pickTarget(ctx): Vector3
	local origin: Vector3 = ctx.Origin
	if math.random() < 0.55 then
		local alive = ctx:AlivePlayers()
		if #alive > 0 then
			local root = Util.GetRoot(alive[math.random(#alive)])
			if root then
				return Vector3.new(root.Position.X + math.random(-5, 5), origin.Y, root.Position.Z + math.random(-5, 5))
			end
		end
	end
	local extent = GRID * TILE / 2 - 3
	return origin + Vector3.new(math.random(-extent, extent), 0, math.random(-extent, extent))
end

local function meteor(ctx, target: Vector3)
	local marker = Util.Part({
		Name = "Warning",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.2, KILL_RADIUS * 2, KILL_RADIUS * 2),
		CFrame = CFrame.new(target + Vector3.new(0, 0.12, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(255, 40, 40),
		Material = Enum.Material.Neon,
		Transparency = 0.6,
		CanCollide = false,
		CanQuery = false,
		CanTouch = false,
		Parent = ctx.Folder,
	})
	TweenService:Create(marker, TweenInfo.new(0.25, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true), {
		Transparency = 0.15,
	}):Play()

	local rock = Util.Part({
		Name = "Meteor",
		Shape = Enum.PartType.Ball,
		Size = Vector3.new(5, 5, 5),
		Position = target + Vector3.new(math.random(-20, 20), 90, math.random(-20, 20)),
		Color = Color3.fromRGB(255, 110, 30),
		Material = Enum.Material.Neon,
		CanCollide = false,
		CanQuery = false,
		CanTouch = false,
		Parent = ctx.Folder,
	})
	Util.Make("Fire", { Size = 8, Heat = 15, Parent = rock })
	TweenService:Create(rock, TweenInfo.new(FALL_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
		Position = target,
	}):Play()
	task.wait(FALL_TIME)
	rock:Destroy()
	marker:Destroy()
	if ctx.Ended then
		return
	end

	local explosion = Instance.new("Explosion")
	explosion.BlastPressure = 0
	explosion.BlastRadius = KILL_RADIUS
	explosion.DestroyJointRadiusPercent = 0
	explosion.ExplosionType = Enum.ExplosionType.NoCraters
	explosion.Position = target
	explosion.Parent = ctx.Folder

	for _, player in ctx:AlivePlayers() do
		local root = Util.GetRoot(player)
		if root then
			local offset = root.Position - target
			local dist = offset.Magnitude
			if dist < KILL_RADIUS + 1 then
				ctx:Eliminate(player, "попал под метеорит", true)
			elseif dist < PUSH_RADIUS then
				local flat = Vector3.new(offset.X, 0, offset.Z)
				local dir = flat.Magnitude > 0.1 and flat.Unit or Vector3.new(1, 0, 0)
				Net.Event("Knockback"):FireClient(player, dir * 55 + Vector3.new(0, 40, 0), 0.4)
			end
		end
	end

	for _, tile in ctx.Data.Tiles :: { BasePart } do
		if tile.CanCollide then
			local flat = Vector3.new(tile.Position.X - target.X, 0, tile.Position.Z - target.Z)
			if flat.Magnitude < KILL_RADIUS - 1 then
				tile.CanCollide = false
				tile.Transparency = 1
			end
		end
	end
end

function MeteorShower.Run(ctx)
	task.wait(1.5)
	local started = os.clock()
	local interval = 1.1
	while not ctx.Ended do
		local count = 1 + math.floor((os.clock() - started) / 20)
		for _ = 1, count do
			task.spawn(meteor, ctx, pickTarget(ctx))
		end
		task.wait(interval)
		interval = math.max(0.4, interval * 0.95)
	end
end

return MeteorShower
