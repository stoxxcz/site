-- 🌋 Лавовая башня: прыгай по спирали вверх, пока лава поднимается. Монетки по пути.

local TweenService = game:GetService("TweenService")

local Data = require(script.Parent.Parent.Data)
local Util = require(script.Parent.Parent.Util)

local PLATFORMS = 30
local PLATFORM_SIZE = 6
local GRACE = 6
local RISE_TIME = 95
local COIN_VALUE = 15

local LavaTower = {
	Id = "LavaTower",
	Title = "🌋 Лавовая башня",
	Description = "Лава поднимается! Прыгай вверх по платформам. Первый наверху — победитель.",
	Mode = "race",
	Duration = 120,
}

function LavaTower.Build(ctx)
	local origin: Vector3 = ctx.Origin

	Util.Part({
		Name = "Base",
		Size = Vector3.new(64, 2, 64),
		Position = origin + Vector3.new(0, -1, 0),
		Color = Color3.fromRGB(50, 40, 40),
		Material = Enum.Material.Basalt,
		Parent = ctx.Folder,
	})

	-- генерируем спираль из платформ с проверенными расстояниями для прыжка
	local angle = 0
	local radius = 16
	local y = 0
	local top = Vector3.zero

	-- следующая точка спирали: центр на расстоянии dist от предыдущего
	local function step(dist: number, rise: number): Vector3
		local newRadius = math.clamp(radius + math.random(-3, 3), 13, 21)
		local cosDelta = (radius * radius + newRadius * newRadius - dist * dist) / (2 * radius * newRadius)
		angle += math.acos(math.clamp(cosDelta, -1, 1))
		radius = newRadius
		y += rise
		return Vector3.new(math.cos(angle) * radius, y, math.sin(angle) * radius)
	end

	for i = 1, PLATFORMS do
		local pos = step(math.random(78, 92) / 10, math.random(26, 38) / 10)
		local t = i / PLATFORMS
		local color = Color3.fromRGB(60, 220, 120):Lerp(Color3.fromRGB(200, 80, 255), t)
		local platform = Util.Part({
			Name = "Step" .. i,
			Size = Vector3.new(PLATFORM_SIZE, 1, PLATFORM_SIZE),
			CFrame = CFrame.lookAt(origin + pos, origin + Vector3.new(0, pos.Y, 0)),
			Color = color,
			Material = Enum.Material.SmoothPlastic,
			Parent = ctx.Folder,
		})
		if i % 4 == 0 then
			local coin = Util.Part({
				Name = "Coin",
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.4, 2.2, 2.2),
				CFrame = platform.CFrame * CFrame.new(0, 2.2, 0),
				Color = Color3.fromRGB(255, 200, 40),
				Material = Enum.Material.Neon,
				CanCollide = false,
				Parent = ctx.Folder,
			})
			local taken = false
			coin.Touched:Connect(function(hit)
				if taken then
					return
				end
				local player = Util.PlayerFromHit(hit)
				if player and ctx:IsAlive(player) then
					taken = true
					coin:Destroy()
					Data.AddCoins(player, COIN_VALUE)
					Util.Notify(player, "🪙 +" .. COIN_VALUE .. " монет", "success")
				end
			end)
		end
		top = pos
	end

	-- финиш: большая площадка следующим шагом спирали
	local finishPos = step(11, 3)

	-- центральная колонна
	Util.Part({
		Name = "Column",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(top.Y + 4, 9, 9),
		CFrame = CFrame.new(origin + Vector3.new(0, (top.Y + 4) / 2 - 1, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(40, 30, 50),
		Material = Enum.Material.Slate,
		Parent = ctx.Folder,
	})

	Util.Part({
		Name = "FinishPad",
		Size = Vector3.new(12, 1, 12),
		Position = origin + finishPos,
		Color = Color3.fromRGB(255, 200, 60),
		Material = Enum.Material.Neon,
		Parent = ctx.Folder,
	})
	local flag = Util.Part({
		Name = "Flag",
		Size = Vector3.new(0.6, 10, 0.6),
		Position = origin + finishPos + Vector3.new(0, 5.5, 0),
		Color = Color3.new(1, 1, 1),
		Parent = ctx.Folder,
	})
	local billboard = Util.Make("BillboardGui", {
		Size = UDim2.fromOffset(200, 50),
		StudsOffset = Vector3.new(0, 6, 0),
		AlwaysOnTop = true,
		Parent = flag,
	})
	Util.Make("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Text = "🏁 ФИНИШ",
		TextScaled = true,
		Font = Enum.Font.GothamBlack,
		TextColor3 = Color3.fromRGB(70, 255, 120),
		Parent = billboard,
	})

	local lava = Util.Part({
		Name = "Lava",
		Size = Vector3.new(160, 6, 160),
		Position = origin + Vector3.new(0, -6, 0),
		Color = Color3.fromRGB(255, 90, 20),
		Material = Enum.Material.Neon,
		CanCollide = false,
		Transparency = 0.1,
		Parent = ctx.Folder,
	})
	Util.Make("PointLight", { Color = Color3.fromRGB(255, 120, 30), Range = 60, Brightness = 3, Parent = lava })

	ctx.Data.Lava = lava
	ctx.Data.Finish = origin + finishPos
	ctx.KillY = origin.Y - 40

	local spawns = {}
	for i = 1, 12 do
		local a = (i / 12) * math.pi * 2
		local pos = origin + Vector3.new(math.cos(a) * 24, 3.5, math.sin(a) * 24)
		spawns[i] = CFrame.lookAt(pos, origin + Vector3.new(16, 3.5, 0))
	end
	return spawns
end

function LavaTower.Run(ctx)
	local lava: BasePart = ctx.Data.Lava
	local finish: Vector3 = ctx.Data.Finish
	local started = os.clock()
	local rising = false

	while not ctx.Ended do
		if not rising and os.clock() - started >= GRACE then
			rising = true
			ctx:Announce("🌋 ЛАВА ПОДНИМАЕТСЯ!", Color3.fromRGB(255, 120, 30), 2)
			local targetY = finish.Y - 3 - lava.Size.Y / 2
			TweenService:Create(lava, TweenInfo.new(RISE_TIME, Enum.EasingStyle.Linear), {
				Position = Vector3.new(lava.Position.X, targetY, lava.Position.Z),
			}):Play()
		end
		local lavaTop = lava.Position.Y + lava.Size.Y / 2
		for _, player in ctx:AlivePlayers() do
			local root = Util.GetRoot(player)
			if root then
				if root.Position.Y < lavaTop + 1.5 then
					ctx:Eliminate(player, "сгорел в лаве", true)
				else
					local flat = Vector3.new(root.Position.X - finish.X, 0, root.Position.Z - finish.Z)
					if root.Position.Y > finish.Y + 0.5 and flat.Magnitude < 7 then
						ctx:Finish(player)
					end
				end
			end
		end
		task.wait(0.1)
	end
end

return LavaTower
