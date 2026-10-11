-- 🔨 Битва молотов: у всех молоты, арена сужается, сбивай друзей в пропасть.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Net = require(ReplicatedStorage.Shared.Net)
local Util = require(script.Parent.Parent.Util)

local START_RADIUS = 36
local MIN_RADIUS = 11
local SHRINK_EVERY = 16
local SHRINK_STEP = 6
local HIT_RANGE = 9.5
local BASE_POWER = 75
local COOLDOWN = 0.7

local POWERUPS = {
	{ Id = "speed", Name = "⚡ СКОРОСТЬ", Color = Color3.fromRGB(80, 200, 255), Duration = 8 },
	{ Id = "mega", Name = "💥 МЕГА-УДАР", Color = Color3.fromRGB(255, 80, 60), Duration = 10 },
	{ Id = "shield", Name = "🛡 ЩИТ", Color = Color3.fromRGB(255, 220, 60), Duration = 8 },
}

local HammerBrawl = {
	Id = "HammerBrawl",
	Title = "🔨 Битва молотов",
	Description = "Сбивай всех молотом с арены! Арена сужается. Бонусы на полу.",
	Mode = "survival",
	Duration = 120,
	MinPlayers = 2, -- в одиночку некого сбивать
}

local function makeHammer(): Tool
	local tool = Instance.new("Tool")
	tool.Name = "Молот"
	tool.ToolTip = "Кликни — удар!"
	tool.CanBeDropped = false
	tool.RequiresHandle = true
	tool.Grip = CFrame.new(0, 0, -1.6)
	tool:SetAttribute("ArenaTool", true)

	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(0.5, 0.5, 4.6)
	handle.Color = Color3.fromRGB(120, 75, 40)
	handle.Material = Enum.Material.Wood
	handle.CanCollide = false
	handle.Massless = true
	handle.Parent = tool

	local head = Instance.new("Part")
	head.Name = "Head"
	head.Size = Vector3.new(3, 1.7, 1.7)
	head.CFrame = handle.CFrame * CFrame.new(0, 0, 2.4)
	head.Color = Color3.fromRGB(255, 200, 60)
	head.Material = Enum.Material.Metal
	head.CanCollide = false
	head.Massless = true
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = head
	weld.Parent = head
	head.Parent = tool
	return tool
end

function HammerBrawl.Build(ctx)
	local origin: Vector3 = ctx.Origin
	local diameter = START_RADIUS * 2
	local floor = Util.Part({
		Name = "Platform",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(4, diameter, diameter),
		CFrame = CFrame.new(origin + Vector3.new(0, -2, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(50, 40, 80),
		Material = Enum.Material.Slate,
		Parent = ctx.Folder,
	})
	local rim = Util.Part({
		Name = "Rim",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3.6, diameter + 1, diameter + 1),
		CFrame = CFrame.new(origin + Vector3.new(0, -2.3, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(255, 60, 170),
		Material = Enum.Material.Neon,
		Parent = ctx.Folder,
	})
	ctx.Data.Floor = floor
	ctx.Data.Rim = rim
	ctx.Data.Radius = START_RADIUS
	ctx.KillY = origin.Y - 25

	local spawns = {}
	for i = 1, 12 do
		local angle = (i / 12) * math.pi * 2
		local pos = origin + Vector3.new(math.cos(angle) * 22, 3.5, math.sin(angle) * 22)
		spawns[i] = CFrame.lookAt(pos, origin + Vector3.new(0, 3.5, 0))
	end
	return spawns
end

function HammerBrawl.Run(ctx)
	local origin: Vector3 = ctx.Origin
	local cooldowns: { [Player]: number } = {}
	local mega: { [Player]: number } = {}
	local shield: { [Player]: number } = {}

	local function swing(attacker: Player)
		local root = Util.GetRoot(attacker)
		if not root then
			return
		end
		local look = Vector3.new(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z)
		look = look.Magnitude > 0.01 and look.Unit or Vector3.new(0, 0, -1)
		local power = BASE_POWER * ((mega[attacker] or 0) > os.clock() and 1.9 or 1)
		for _, victim in ctx:AlivePlayers() do
			if victim ~= attacker then
				local victimRoot = Util.GetRoot(victim)
				if victimRoot then
					local offset = victimRoot.Position - root.Position
					local flat = Vector3.new(offset.X, 0, offset.Z)
					local dist = flat.Magnitude
					if dist < HIT_RANGE and math.abs(offset.Y) < 6 then
						local dir = dist > 0.1 and flat.Unit or look
						if dir:Dot(look) > 0.2 or dist < 3 then
							if (shield[victim] or 0) > os.clock() then
								Util.Notify(attacker, "🛡 У него щит!", "info")
							else
								Net.Event("Knockback"):FireClient(victim, dir * power + Vector3.new(0, 38, 0), 0.6)
								Util.PlaySoundAt(victimRoot.Position, Util.Sounds.Swoosh, 1, 0.8)
							end
						end
					end
				end
			end
		end
	end

	for _, player in ctx:AlivePlayers() do
		local tool = makeHammer()
		tool.Activated:Connect(function()
			if ctx.Ended or not ctx:IsAlive(player) or tool.Parent ~= player.Character then
				return
			end
			local now = os.clock()
			if (cooldowns[player] or 0) > now then
				return
			end
			cooldowns[player] = now + COOLDOWN
			local anim = Instance.new("StringValue")
			anim.Name = "toolanim"
			anim.Value = "Slash"
			anim.Parent = tool
			task.delay(0.12, swing, player)
		end)
		local backpack = player:FindFirstChildOfClass("Backpack")
		local humanoid = Util.GetHumanoid(player)
		if backpack and humanoid then
			tool.Parent = backpack
			humanoid:EquipTool(tool)
		end
	end

	local function applyPowerup(player: Player, powerup)
		local until_ = os.clock() + powerup.Duration
		if powerup.Id == "speed" then
			local humanoid = Util.GetHumanoid(player)
			if humanoid then
				humanoid.WalkSpeed = 28
				task.delay(powerup.Duration, function()
					if humanoid.Parent and not ctx.Ended then
						humanoid.WalkSpeed = 16
					end
				end)
			end
		elseif powerup.Id == "mega" then
			mega[player] = until_
		elseif powerup.Id == "shield" then
			shield[player] = until_
			local character = player.Character
			if character then
				local field = Instance.new("ForceField")
				field.Parent = character
				game:GetService("Debris"):AddItem(field, powerup.Duration)
			end
		end
		Util.AnnounceTo(player, powerup.Name, powerup.Color, 1.5)
		Util.NotifyAll(string.format("%s подобрал %s", player.DisplayName, powerup.Name), "info")
	end

	local function spawnPowerup()
		local radius: number = ctx.Data.Radius
		local powerup = POWERUPS[math.random(#POWERUPS)]
		local angle = math.random() * math.pi * 2
		local dist = math.random() * (radius - 4)
		local orb = Util.Part({
			Name = "Powerup",
			Shape = Enum.PartType.Ball,
			Size = Vector3.new(3, 3, 3),
			Position = origin + Vector3.new(math.cos(angle) * dist, 2.5, math.sin(angle) * dist),
			Color = powerup.Color,
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = ctx.Folder,
		})
		Util.Make("PointLight", { Color = powerup.Color, Range = 12, Brightness = 2, Parent = orb })
		local billboard = Util.Make("BillboardGui", {
			Size = UDim2.fromOffset(140, 30),
			StudsOffset = Vector3.new(0, 2.5, 0),
			AlwaysOnTop = true,
			MaxDistance = 120,
			Parent = orb,
		})
		local label = Util.Make("TextLabel", {
			Size = UDim2.fromScale(1, 1),
			BackgroundTransparency = 1,
			Text = powerup.Name,
			TextScaled = true,
			Font = Enum.Font.GothamBlack,
			TextColor3 = powerup.Color,
			Parent = billboard,
		})
		Util.Make("UIStroke", { Thickness = 2, Parent = label })
		local taken = false
		orb.Touched:Connect(function(hit)
			if taken or ctx.Ended then
				return
			end
			local player = Util.PlayerFromHit(hit)
			if player and ctx:IsAlive(player) then
				taken = true
				orb:Destroy()
				applyPowerup(player, powerup)
			end
		end)
		task.delay(12, function()
			if orb.Parent then
				orb:Destroy()
			end
		end)
	end

	local function shrink()
		local radius = math.max(MIN_RADIUS, (ctx.Data.Radius :: number) - SHRINK_STEP)
		if radius == ctx.Data.Radius then
			return
		end
		ctx.Data.Radius = radius
		ctx:Announce("⚠️ Арена сужается!", Color3.fromRGB(255, 120, 60), 1.5)
		local info = TweenInfo.new(3, Enum.EasingStyle.Quad)
		local floor: BasePart = ctx.Data.Floor
		local rim: BasePart = ctx.Data.Rim
		TweenService:Create(floor, info, { Size = Vector3.new(4, radius * 2, radius * 2) }):Play()
		TweenService:Create(rim, info, { Size = Vector3.new(3.6, radius * 2 + 1, radius * 2 + 1) }):Play()
	end

	local started = os.clock()
	local nextShrink = started + SHRINK_EVERY
	local nextPowerup = started + 4
	while not ctx.Ended do
		local now = os.clock()
		if now >= nextShrink then
			nextShrink = now + SHRINK_EVERY
			shrink()
		end
		if now >= nextPowerup then
			nextPowerup = now + math.random(5, 8)
			spawnPowerup()
		end
		task.wait(0.25)
	end
end

return HammerBrawl
