-- Звуки интерфейса. Используются встроенные файлы клиента Roblox (rbxasset://),
-- поэтому ничего не нужно загружать. Свои звуки можно вписать сюда (rbxassetid://ID).

local Debris = game:GetService("Debris")
local SoundService = game:GetService("SoundService")

local Sounds = {}

local IDS = {
	Click = "rbxasset://sounds/clickfast.wav",
	Tick = "rbxasset://sounds/clickfast.wav",
	Win = "rbxasset://sounds/electronicpingshort.wav",
	Coin = "rbxasset://sounds/electronicpingshort.wav",
	Lose = "rbxasset://sounds/swoosh.wav",
	Whoosh = "rbxasset://sounds/swoosh.wav",
}

function Sounds.Play(name: string, volume: number?, speed: number?)
	local id = IDS[name]
	if not id then
		return
	end
	local sound = Instance.new("Sound")
	sound.SoundId = id
	sound.Volume = volume or 0.5
	sound.PlaybackSpeed = speed or 1
	sound.Parent = SoundService
	sound:Play()
	Debris:AddItem(sound, 3)
end

return Sounds
