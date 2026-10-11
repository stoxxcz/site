-- АЗАРТ АРЕНА — точка входа сервера.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = require(ReplicatedStorage.Shared.Net)

local MapBuilder = require(script.MapBuilder)
local map = MapBuilder.Build()

local Data = require(script.Data)
Data.Init()

local Characters = require(script.Characters)
Characters.Init()

local Feed = require(script.Feed)
Feed.Init(map.LeaderboardLabel, map.FeedLabel)

local Betting = require(script.Betting)
Betting.Init()

local Shop = require(script.Shop)
Shop.Init()

require(script.Slots).Init(map.SlotMachines)

local Roulette = require(script.Roulette)
Roulette.Init(map.RouletteLabel)

require(script.Duels).Init()

-- клиент просит актуальное состояние, когда готов его принять
Net.Event("RequestSync").OnServerEvent:Connect(function(player: Player)
	if not Data.WaitFor(player, 20) then
		return
	end
	Betting.SendTo(player)
	Shop.SendState(player)
	Roulette.SendTo(player)
end)

require(script.RoundManager).Start()

print(string.format("[AzartArena] Сервер запущен. Игроков: %d", #Players:GetPlayers()))
