-- АЗАРТ АРЕНА — точка входа клиента.

local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = require(ReplicatedStorage.Shared.Net)

local Hud = require(script.Hud)
local player = Players.LocalPlayer

Hud.Init()

require(script.Panels.Bets).Init(Hud)
require(script.Panels.Roulette).Init(Hud)
require(script.Panels.Duel).Init(Hud)
require(script.Panels.Shop).Init(Hud)
require(script.SlotsView).Init(Hud)
require(script.Spectate).Init(Hud)
require(script.WheelView).Init()

-- стойки в лобби открывают нужные панели
ProximityPromptService.PromptTriggered:Connect(function(prompt: ProximityPrompt)
	local panel = prompt:GetAttribute("OpenPanel")
	if type(panel) == "string" then
		Hud.OpenPanel(panel)
	end
end)

-- отбрасывание (молоты, метеориты, батуты)
Net.Event("Knockback").OnClientEvent:Connect(function(velocity: Vector3, stun: number?)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not humanoid or not root or not root:IsA("BasePart") then
		return
	end
	local stunTime = stun or 0
	if stunTime > 0 then
		humanoid.PlatformStand = true
		task.delay(stunTime, function()
			if humanoid.Parent then
				humanoid.PlatformStand = false
			end
		end)
	else
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
	root.AssemblyLinearVelocity = velocity
end)

Net.Event("RequestSync"):FireServer()

task.delay(2, function()
	Hud.Toast("🎰 Добро пожаловать в АЗАРТ АРЕНУ! Меню — слева, слоты — у северной стены.", "bigwin")
end)
