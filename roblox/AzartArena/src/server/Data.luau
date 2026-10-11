-- Монеты, победы, покупки. Сохраняется в DataStore (работает в опубликованной игре
-- или в Studio с включённым "Enable Studio Access to API Services").

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

export type Profile = {
	Coins: number,
	Wins: number,
	BiggestWin: number,
	Owned: { [string]: boolean },
	Equipped: string,
	CanSave: boolean,
	LastWelfare: number,
}

local Data = {}

local profiles: { [Player]: Profile } = {}
local changedEvent = Instance.new("BindableEvent")
local loadedEvent = Instance.new("BindableEvent")

-- (player, field)
Data.Changed = changedEvent.Event
-- (player)
Data.Loaded = loadedEvent.Event

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(Config.DataStoreName)
	end)
	if ok then
		store = result
	else
		warn("[AzartArena] DataStore недоступен, прогресс не будет сохраняться:", result)
	end
end

local function newProfile(): Profile
	return {
		Coins = Config.StartCoins,
		Wins = 0,
		BiggestWin = 0,
		Owned = {},
		Equipped = "",
		CanSave = false,
		LastWelfare = 0,
	}
end

local function keyFor(player: Player): string
	return "player_" .. player.UserId
end

local function sync(player: Player)
	local profile = profiles[player]
	if not profile then
		return
	end
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		local coins = stats:FindFirstChild("Монеты")
		local wins = stats:FindFirstChild("Победы")
		if coins and coins:IsA("IntValue") then
			coins.Value = profile.Coins
		end
		if wins and wins:IsA("IntValue") then
			wins.Value = profile.Wins
		end
	end
	player:SetAttribute("Coins", profile.Coins)
	player:SetAttribute("Wins", profile.Wins)
end

local function save(player: Player, profile: Profile)
	if not store or not profile.CanSave then
		return
	end
	local owned = {}
	for id in profile.Owned do
		table.insert(owned, id)
	end
	local payload = {
		Coins = profile.Coins,
		Wins = profile.Wins,
		BiggestWin = profile.BiggestWin,
		Owned = owned,
		Equipped = profile.Equipped,
	}
	local dataStore = store :: DataStore
	local ok, err = pcall(function()
		dataStore:SetAsync(keyFor(player), payload, { player.UserId })
	end)
	if not ok then
		warn("[AzartArena] Не удалось сохранить", player.Name, err)
	end
end

local function load(player: Player)
	local profile = newProfile()

	if store then
		local dataStore = store :: DataStore
		local ok, saved = false, nil
		for _ = 1, 3 do
			ok, saved = pcall(function()
				return dataStore:GetAsync(keyFor(player))
			end)
			if ok then
				break
			end
			task.wait(1)
		end
		if ok then
			profile.CanSave = true
			if type(saved) == "table" then
				profile.Coins = tonumber(saved.Coins) or profile.Coins
				profile.Wins = tonumber(saved.Wins) or 0
				profile.BiggestWin = tonumber(saved.BiggestWin) or 0
				if type(saved.Owned) == "table" then
					for _, id in saved.Owned do
						if type(id) == "string" then
							profile.Owned[id] = true
						end
					end
				end
				if type(saved.Equipped) == "string" then
					profile.Equipped = saved.Equipped
				end
			end
		else
			warn("[AzartArena] Не удалось загрузить данные", player.Name, saved)
		end
	end

	if not player.Parent then
		return
	end

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local coins = Instance.new("IntValue")
	coins.Name = "Монеты"
	coins.Parent = stats
	local wins = Instance.new("IntValue")
	wins.Name = "Победы"
	wins.Parent = stats
	stats.Parent = player

	profiles[player] = profile
	sync(player)
	loadedEvent:Fire(player)
end

function Data.Get(player: Player): Profile?
	return profiles[player]
end

-- Ждёт загрузки профиля (до timeout секунд).
function Data.WaitFor(player: Player, timeout: number?): Profile?
	local deadline = os.clock() + (timeout or 15)
	while not profiles[player] and player.Parent and os.clock() < deadline do
		task.wait(0.1)
	end
	return profiles[player]
end

function Data.GetCoins(player: Player): number
	local profile = profiles[player]
	return profile and profile.Coins or 0
end

function Data.AddCoins(player: Player, amount: number)
	local profile = profiles[player]
	if not profile or amount == 0 then
		return
	end
	profile.Coins = math.max(0, math.floor(profile.Coins + amount))
	sync(player)
	changedEvent:Fire(player, "Coins")
end

-- Списывает монеты, если хватает. Возвращает true при успехе.
function Data.TrySpend(player: Player, amount: number): boolean
	local profile = profiles[player]
	if not profile then
		return false
	end
	amount = math.floor(amount)
	if amount <= 0 or profile.Coins < amount then
		return false
	end
	profile.Coins -= amount
	sync(player)
	changedEvent:Fire(player, "Coins")
	return true
end

function Data.AddWin(player: Player)
	local profile = profiles[player]
	if not profile then
		return
	end
	profile.Wins += 1
	sync(player)
	changedEvent:Fire(player, "Wins")
end

function Data.RecordWin(player: Player, amount: number)
	local profile = profiles[player]
	if profile and amount > profile.BiggestWin then
		profile.BiggestWin = amount
	end
end

function Data.SetOwned(player: Player, id: string)
	local profile = profiles[player]
	if profile then
		profile.Owned[id] = true
		changedEvent:Fire(player, "Owned")
	end
end

function Data.SetEquipped(player: Player, id: string)
	local profile = profiles[player]
	if profile then
		profile.Equipped = id
		changedEvent:Fire(player, "Equipped")
	end
end

function Data.Init()
	Players.PlayerAdded:Connect(load)
	for _, player in Players:GetPlayers() do
		task.spawn(load, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		local profile = profiles[player]
		if profile then
			save(player, profile)
			profiles[player] = nil
		end
	end)

	game:BindToClose(function()
		local pending = 0
		for player, profile in profiles do
			pending += 1
			task.spawn(function()
				save(player, profile)
				pending -= 1
			end)
		end
		local deadline = os.clock() + 25
		while pending > 0 and os.clock() < deadline do
			task.wait(0.1)
		end
	end)

	-- автосохранение
	task.spawn(function()
		while true do
			task.wait(120)
			for player, profile in profiles do
				task.spawn(save, player, profile)
			end
		end
	end)
end

return Data
