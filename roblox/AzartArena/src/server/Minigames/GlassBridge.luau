-- 🌉 Стеклянный мост: в каждом ряду одна плита фальшивая. Упал — назад на старт.
-- Каждое падение раскрывает путь остальным. Первый дошедший забирает больше всех.

local Debris = game:GetService("Debris")

local Util = require(script.Parent.Parent.Util)

local ROWS = 10
local LATERAL = 4.6
local SPACING = 9
local FIRST_ROW_Z = 13
local GLASS = Color3.fromRGB(170, 225, 255)

local GlassBridge = {
	Id = "GlassBridge",
	Title = "🌉 Стеклянный мост",
	Description = "Одна из двух плит в каждом ряду — ловушка. Дойди до финиша первым!",
	Mode = "race",
	Duration = 100,
}

local function shatter(ctx, panel: BasePart)
	panel.CanCollide = false
	panel.Transparency = 1
	Util.PlaySoundAt(panel.Position, Util.Sounds.Glass, 1, 0.6)
	for _ = 1, 8 do
		local shard = Util.Part({
			Name = "Shard",
			Size = Vector3.new(math.random(8, 20) / 10, 0.2, math.random(8, 20) / 10),
			CFrame = panel.CFrame
				* CFrame.new(math.random(-25, 25) / 10, 0, math.random(-25, 25) / 10)
				* CFrame.Angles(math.random() * 3, math.random() * 3, math.random() * 3),
			Color = GLASS,
			Material = Enum.Material.Glass,
			Transparency = 0.3,
			Anchored = false,
			CanCollide = false,
			CanQuery = false,
			CanTouch = false,
			Parent = ctx.Folder,
		})
		Debris:AddItem(shard, 3)
	end
end

function GlassBridge.Build(ctx)
	local origin: Vector3 = ctx.Origin
	local finishStart = FIRST_ROW_Z + (ROWS - 1) * SPACING + 6

	Util.Part({
		Name = "Start",
		Size = Vector3.new(26, 2, 14),
		Position = origin + Vector3.new(0, -1, 0),
		Color = Color3.fromRGB(60, 50, 90),
		Material = Enum.Material.Slate,
		Parent = ctx.Folder,
	})
	Util.Part({
		Name = "Finish",
		Size = Vector3.new(26, 2, 16),
		Position = origin + Vector3.new(0, -1, finishStart + 8),
		Color = Color3.fromRGB(255, 200, 60),
		Material = Enum.Material.SmoothPlastic,
		Parent = ctx.Folder,
	})
	-- арка финиша
	for _, x in { -12, 12 } do
		Util.Part({
			Name = "ArchPost",
			Size = Vector3.new(1.5, 14, 1.5),
			Position = origin + Vector3.new(x, 7, finishStart + 2),
			Color = Color3.fromRGB(70, 255, 120),
			Material = Enum.Material.Neon,
			Parent = ctx.Folder,
		})
	end
	local arch = Util.Part({
		Name = "ArchTop",
		Size = Vector3.new(25.5, 3, 1.5),
		Position = origin + Vector3.new(0, 14.5, finishStart + 2),
		Color = Color3.fromRGB(20, 20, 30),
		Parent = ctx.Folder,
	})
	local gui = Util.Make("SurfaceGui", { Face = Enum.NormalId.Front, LightInfluence = 0, Parent = arch })
	Util.Make("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Text = "🏁 ФИНИШ 🏁",
		TextScaled = true,
		Font = Enum.Font.GothamBlack,
		TextColor3 = Color3.fromRGB(70, 255, 120),
		Parent = gui,
	})
	-- надпись видна со старта: поворачиваем лицевую сторону к игрокам
	arch.CFrame = CFrame.lookAt(arch.Position, arch.Position - Vector3.new(0, 0, 1))

	for row = 1, ROWS do
		local z = FIRST_ROW_Z + (row - 1) * SPACING
		local fakeSide = math.random(2)
		for side = 1, 2 do
			local x = side == 1 and -LATERAL or LATERAL
			local panel = Util.Part({
				Name = "Glass",
				Size = Vector3.new(6, 0.6, 6),
				Position = origin + Vector3.new(x, -0.3, z),
				Color = GLASS,
				Material = Enum.Material.Glass,
				Transparency = 0.35,
				Reflectance = 0.1,
				Parent = ctx.Folder,
			})
			if side == fakeSide then
				local broken = false
				panel.Touched:Connect(function(hit)
					if broken or ctx.Ended then
						return
					end
					if not Util.PlayerFromHit(hit) then
						return
					end
					broken = true
					shatter(ctx, panel)
				end)
			end
		end
		-- опоры моста по бокам
		for _, x in { -LATERAL * 2 - 1.5, LATERAL * 2 + 1.5 } do
			Util.Part({
				Name = "Rail",
				Size = Vector3.new(0.6, 0.6, SPACING),
				Position = origin + Vector3.new(x, -0.3, z),
				Color = Color3.fromRGB(255, 60, 170),
				Material = Enum.Material.Neon,
				CanCollide = false,
				Parent = ctx.Folder,
			})
		end
	end

	local spawns = {}
	for i = 1, 12 do
		spawns[i] = CFrame.lookAt(
			origin + Vector3.new(math.random(-10, 10), 3.5, math.random(-5, 3)),
			origin + Vector3.new(0, 3.5, 50)
		)
	end
	ctx.Data.Spawns = spawns
	ctx.Data.FinishZ = origin.Z + finishStart
	ctx.KillY = origin.Y - 25
	ctx.OnFall = function(player: Player)
		Util.Teleport(player, spawns[math.random(#spawns)])
		Util.Notify(player, "💥 Стекло треснуло! Назад на старт", "error")
	end
	return spawns
end

function GlassBridge.Run(ctx)
	local origin: Vector3 = ctx.Origin
	local finishZ: number = ctx.Data.FinishZ
	while not ctx.Ended do
		for _, player in ctx:AlivePlayers() do
			local root = Util.GetRoot(player)
			if root and root.Position.Z > finishZ and root.Position.Y > origin.Y - 2 then
				ctx:Finish(player)
			end
		end
		task.wait(0.15)
	end
end

return GlassBridge
