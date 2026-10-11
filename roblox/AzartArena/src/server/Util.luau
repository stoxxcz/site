-- Мелкие помощники для сервера: детали, игроки, уведомления, звуки.

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)

local Util = {}

-- Создаёт закреплённую деталь со свойствами из таблицы.
function Util.Part(props: { [string]: any }): Part
	local part = Instance.new("Part")
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	for key, value in props do
		if key ~= "Parent" then
			(part :: any)[key] = value
		end
	end
	part.Parent = props.Parent
	return part
end

-- Создаёт любой объект со свойствами из таблицы.
function Util.Make(className: string, props: { [string]: any }): any
	local inst = Instance.new(className)
	for key, value in props do
		if key ~= "Parent" then
			(inst :: any)[key] = value
		end
	end
	inst.Parent = props.Parent
	return inst
end

function Util.GetHumanoid(player: Player): Humanoid?
	local character = player.Character
	if not character then
		return nil
	end
	return character:FindFirstChildOfClass("Humanoid")
end

function Util.GetRoot(player: Player): BasePart?
	local character = player.Character
	if not character then
		return nil
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		return root
	end
	return nil
end

function Util.IsAlive(player: Player): boolean
	local humanoid = Util.GetHumanoid(player)
	return humanoid ~= nil and humanoid.Health > 0 and Util.GetRoot(player) ~= nil
end

function Util.Teleport(player: Player, cframe: CFrame)
	local character = player.Character
	if character then
		local root = Util.GetRoot(player)
		if root then
			root.AssemblyLinearVelocity = Vector3.zero
		end
		character:PivotTo(cframe)
	end
end

function Util.TeleportToLobby(player: Player)
	local angle = math.random() * math.pi * 2
	local radius = math.random() * 6
	local pos = Config.LobbySpawn + Vector3.new(math.cos(angle) * radius, 0, math.sin(angle) * radius)
	Util.Teleport(player, CFrame.new(pos))
end

function Util.ResetMovement(player: Player)
	local humanoid = Util.GetHumanoid(player)
	if humanoid then
		humanoid.WalkSpeed = 16
		humanoid.JumpHeight = 7.2
		humanoid.JumpPower = 50
	end
end

function Util.Shuffle<T>(list: { T }): { T }
	for i = #list, 2, -1 do
		local j = math.random(i)
		list[i], list[j] = list[j], list[i]
	end
	return list
end

function Util.Notify(player: Player, text: string, kind: string?)
	Net.Event("Notify"):FireClient(player, text, kind or "info")
end

function Util.NotifyAll(text: string, kind: string?)
	Net.Event("Notify"):FireAllClients(text, kind or "info")
end

function Util.Announce(text: string, color: Color3?, duration: number?)
	Net.Event("Announce"):FireAllClients(text, color or Color3.fromRGB(255, 210, 60), duration or 2)
end

function Util.AnnounceTo(player: Player, text: string, color: Color3?, duration: number?)
	Net.Event("Announce"):FireClient(player, text, color or Color3.fromRGB(255, 210, 60), duration or 2)
end

-- Встроенные звуки клиента Roblox (не требуют загрузки ассетов).
Util.Sounds = {
	Glass = "rbxasset://sounds/collide.wav",
	Boom = "rbxasset://sounds/collide.wav",
	Ping = "rbxasset://sounds/electronicpingshort.wav",
	Swoosh = "rbxasset://sounds/swoosh.wav",
}

function Util.PlaySoundAt(position: Vector3, soundId: string, volume: number?, speed: number?)
	local holder = Instance.new("Part")
	holder.Anchored = true
	holder.CanCollide = false
	holder.CanQuery = false
	holder.CanTouch = false
	holder.Transparency = 1
	holder.Size = Vector3.new(1, 1, 1)
	holder.Position = position
	local sound = Instance.new("Sound")
	sound.SoundId = soundId
	sound.Volume = volume or 0.8
	sound.PlaybackSpeed = speed or 1
	sound.RollOffMaxDistance = 250
	sound.Parent = holder
	holder.Parent = workspace
	sound:Play()
	Debris:AddItem(holder, 4)
end

function Util.PlayerFromHit(hit: BasePart): Player?
	local model = hit:FindFirstAncestorOfClass("Model")
	if not model then
		return nil
	end
	return Players:GetPlayerFromCharacter(model)
end

return Util
