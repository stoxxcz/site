-- 🧊 Падающие плиты: три этажа плиток, каждая исчезает, если на неё наступить.

local Util = require(script.Parent.Parent.Util)

local GRID = 12
local TILE = 6
local LAYERS = 3
local LAYER_GAP = 24
local LAYER_COLORS = {
	Color3.fromRGB(60, 220, 255),
	Color3.fromRGB(255, 70, 200),
	Color3.fromRGB(255, 220, 60),
}

local FallingTiles = {
	Id = "FallingTiles",
	Title = "🧊 Падающие плиты",
	Description = "Плитки исчезают под ногами. Не стой на месте! Последний выживший побеждает.",
	Mode = "survival",
	Duration = 120,
}

function FallingTiles.Build(ctx)
	local origin: Vector3 = ctx.Origin
	local half = (GRID + 1) / 2
	local states: { [BasePart]: string } = {}
	for layer = 1, LAYERS do
		local y = -(layer - 1) * LAYER_GAP - 0.5
		for x = 1, GRID do
			for z = 1, GRID do
				local part = Util.Part({
					Name = "FallTile",
					Size = Vector3.new(TILE - 0.25, 1, TILE - 0.25),
					Position = origin + Vector3.new((x - half) * TILE, y, (z - half) * TILE),
					Color = LAYER_COLORS[layer],
					Material = Enum.Material.Glass,
					Transparency = 0.15,
					Parent = ctx.Folder,
				})
				states[part] = "solid"
			end
		end
	end
	ctx.Data.States = states
	ctx.KillY = origin.Y - (LAYERS - 1) * LAYER_GAP - 30

	local spawns = {}
	for i = 1, 16 do
		spawns[i] = CFrame.new(origin + Vector3.new(math.random(-30, 30), 4, math.random(-30, 30)))
	end
	return spawns
end

function FallingTiles.Run(ctx)
	local states: { [BasePart]: string } = ctx.Data.States
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { ctx.Folder }

	local function trigger(part: BasePart)
		states[part] = "falling"
		part.Color = Color3.new(1, 1, 1)
		part.Material = Enum.Material.Neon
		task.delay(0.45, function()
			part.Transparency = 1
			part.CanCollide = false
			states[part] = "gone"
		end)
	end

	task.wait(1)
	while not ctx.Ended do
		for _, player in ctx:AlivePlayers() do
			local root = Util.GetRoot(player)
			if root then
				-- проверяем центр и чуть впереди, чтобы плитки исчезали честно
				for _, offset in { Vector3.zero, root.AssemblyLinearVelocity * Vector3.new(0.05, 0, 0.05) } do
					local result = workspace:Raycast(root.Position + offset, Vector3.new(0, -7, 0), params)
					local hit = result and result.Instance
					if hit and hit:IsA("BasePart") and states[hit] == "solid" then
						trigger(hit)
					end
				end
			end
		end
		task.wait(0.08)
	end
end

return FallingTiles
