-- Цикл раундов: перерыв со ставками -> мини-игра -> награды -> снова.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Betting = require(script.Parent.Betting)
local Data = require(script.Parent.Data)
local Util = require(script.Parent.Util)

local RoundManager = {}

local state = Net.State()

local MINIGAMES = {
	require(script.Parent.Minigames.ColorFloor),
	require(script.Parent.Minigames.GlassBridge),
	require(script.Parent.Minigames.FallingTiles),
	require(script.Parent.Minigames.HammerBrawl),
	require(script.Parent.Minigames.LavaTower),
	require(script.Parent.Minigames.MeteorShower),
}

local GOLD = Color3.fromRGB(255, 200, 60)
local RED = Color3.fromRGB(255, 70, 80)
local GREEN = Color3.fromRGB(70, 255, 120)

------------------------------------------------------------------------
-- Контекст раунда, который получают мини-игры
------------------------------------------------------------------------

local Context = {}
Context.__index = Context

function Context.new(minigame, participants: { Player })
	local self = setmetatable({}, Context)
	self.Minigame = minigame
	self.Mode = minigame.Mode
	self.Origin = Config.ArenaOrigin
	self.Participants = participants
	self.Alive = {} :: { [Player]: boolean }
	self.Characters = {} :: { [Player]: Model }
	self.Finished = {} :: { Player }
	self.StartCount = #participants
	self.Ended = false
	self.EndsAt = math.huge
	self.KillY = Config.ArenaOrigin.Y - 60
	self.OnFall = nil :: ((Player) -> ())?
	self.Data = {} :: { [string]: any }

	local folder = Instance.new("Folder")
	folder.Name = "Arena"
	folder.Parent = workspace
	self.Folder = folder
	return self
end

function Context:AlivePlayers(): { Player }
	local list = {}
	for player in self.Alive do
		table.insert(list, player)
	end
	return list
end

function Context:AliveCount(): number
	local n = 0
	for _ in self.Alive do
		n += 1
	end
	return n
end

function Context:IsAlive(player: Player): boolean
	return self.Alive[player] == true
end

function Context:Eliminate(player: Player, reason: string?, kill: boolean?)
	if not self.Alive[player] then
		return
	end
	self.Alive[player] = nil
	player:SetAttribute("InRound", false)
	if kill then
		local humanoid = Util.GetHumanoid(player)
		if humanoid and humanoid.Health > 0 then
			humanoid.Health = 0
		end
	end
	Util.NotifyAll(string.format("💀 %s выбывает%s", player.DisplayName, reason and (" — " .. reason) or ""), "death")
	state:SetAttribute("Alive", self:AliveCount())
end

function Context:Finish(player: Player)
	if not self.Alive[player] then
		return
	end
	self.Alive[player] = nil
	table.insert(self.Finished, player)
	player:SetAttribute("InRound", false)
	local place = #self.Finished
	Util.NotifyAll(string.format("🏁 %s финишировал %d-м!", player.DisplayName, place), "success")
	Util.AnnounceTo(player, place == 1 and "🥇 ПЕРВОЕ МЕСТО!" or ("🏁 ФИНИШ #" .. place), GOLD, 2.5)
	if place == 1 then
		self:SetEndsAt(math.min(self.EndsAt, Net.Now() + 20))
	end
	state:SetAttribute("Alive", self:AliveCount())
end

function Context:SetEndsAt(t: number)
	self.EndsAt = t
	state:SetAttribute("EndsAt", t)
end

function Context:Announce(text: string, color: Color3?, duration: number?)
	Util.Announce(text, color, duration)
end

------------------------------------------------------------------------

local function setPhase(phase: string, duration: number?)
	state:SetAttribute("Phase", phase)
	state:SetAttribute("EndsAt", duration and (Net.Now() + duration) or 0)
end

local bag = {}
local lastId = nil
local function pickMinigame(playerCount: number)
	for _ = 1, #MINIGAMES * 2 do
		if #bag == 0 then
			for _, minigame in MINIGAMES do
				table.insert(bag, minigame)
			end
			Util.Shuffle(bag)
			if bag[#bag].Id == lastId and #bag > 1 then
				bag[1], bag[#bag] = bag[#bag], bag[1]
			end
		end
		local minigame = table.remove(bag)
		if minigame and (minigame.MinPlayers or 1) <= playerCount then
			lastId = minigame.Id
			return minigame
		end
	end
	return MINIGAMES[1]
end

local function removeArenaTools(player: Player)
	local containers = { player:FindFirstChildOfClass("Backpack"), player.Character }
	for _, container in containers do
		if container then
			for _, item in container:GetChildren() do
				if item:IsA("Tool") and item:GetAttribute("ArenaTool") then
					item:Destroy()
				end
			end
		end
	end
end

local function setAnchored(player: Player, anchored: boolean)
	local root = Util.GetRoot(player)
	if root then
		root.Anchored = anchored
	end
end

local function checkFalls(ctx)
	for _, player in ctx:AlivePlayers() do
		if not player.Parent then
			ctx.Alive[player] = nil
			continue
		end
		local character = player.Character
		local humanoid = Util.GetHumanoid(player)
		local root = Util.GetRoot(player)
		if character ~= ctx.Characters[player] or not humanoid or not root or humanoid.Health <= 0 then
			ctx:Eliminate(player)
		elseif root.Position.Y < ctx.KillY then
			if ctx.OnFall then
				ctx.OnFall(player)
			else
				ctx:Eliminate(player, "упал", true)
			end
		end
	end
	state:SetAttribute("Alive", ctx:AliveCount())
end

local function shouldEnd(ctx): boolean
	if Net.Now() >= ctx.EndsAt then
		return true
	end
	local alive = ctx:AliveCount()
	if alive == 0 then
		return true
	end
	if ctx.Mode == "survival" and ctx.StartCount >= 2 and alive <= 1 then
		return true
	end
	return false
end

local function namesOf(players: { Player }): string
	local names = {}
	for _, player in players do
		table.insert(names, player.DisplayName)
	end
	return table.concat(names, ", ")
end

local function awardResults(ctx)
	for _, player in ctx.Participants do
		if player.Parent then
			Data.AddCoins(player, Config.Rewards.Participation)
		end
	end

	local betWinners: { Player } = {}
	if ctx.Mode == "survival" then
		local survivors = {}
		for _, player in ctx:AlivePlayers() do
			if player.Parent then
				table.insert(survivors, player)
			end
		end
		local reward = #survivors == 1 and Config.Rewards.SoloSurvivor or Config.Rewards.Survivor
		for _, player in survivors do
			Data.AddCoins(player, reward)
			Data.AddWin(player)
			Util.Notify(player, string.format("🏆 Ты выжил! +%d 💰", reward), "success")
		end
		betWinners = survivors
		if #survivors == 1 then
			Util.Announce("🏆 ПОБЕДИЛ " .. survivors[1].DisplayName .. "!", GOLD, 4)
		elseif #survivors > 1 then
			Util.Announce("🏆 Выжили: " .. namesOf(survivors), GREEN, 4)
		else
			Util.Announce("💀 Никто не выжил!", RED, 4)
		end
	else
		for place, player in ctx.Finished do
			if player.Parent then
				local reward = Config.Rewards.RacePlaces[place] or Config.Rewards.RaceFinisher
				Data.AddCoins(player, reward)
				if place == 1 then
					Data.AddWin(player)
				end
				Util.Notify(player, string.format("🏁 %d место! +%d 💰", place, reward), "success")
			end
		end
		local first = ctx.Finished[1]
		if first and first.Parent then
			betWinners = { first }
			Util.Announce("🥇 ПОБЕДИЛ " .. first.DisplayName .. "!", GOLD, 4)
		else
			Util.Announce("😱 Никто не дошёл до финиша!", RED, 4)
		end
	end

	Betting.Resolve(betWinners)
end

local function runRound(minigame)
	local participants: { Player } = {}
	for _, player in Players:GetPlayers() do
		if Util.IsAlive(player) and Data.Get(player) then
			table.insert(participants, player)
		end
	end
	if #participants == 0 then
		Betting.RefundAll()
		return
	end
	Betting.Lock(participants)

	local ctx = Context.new(minigame, participants)
	local ok, spawns = pcall(minigame.Build, ctx)
	if not ok or type(spawns) ~= "table" or #spawns == 0 then
		warn("[AzartArena] Ошибка постройки арены", minigame.Id, spawns)
		ctx.Folder:Destroy()
		Betting.RefundAll()
		return
	end

	state:SetAttribute("Title", minigame.Title)
	state:SetAttribute("Desc", minigame.Description)
	state:SetAttribute("Total", #participants)
	setPhase("Countdown", Config.Round.Countdown + 1)

	task.wait(1) -- даём арене прогрузиться у клиентов

	Util.Shuffle(participants)
	for i, player in participants do
		if Util.IsAlive(player) then
			local spawnCf = spawns[(i - 1) % #spawns + 1]
			Util.Teleport(player, spawnCf)
			setAnchored(player, true)
			ctx.Alive[player] = true
			ctx.Characters[player] = player.Character
			player:SetAttribute("InRound", true)
		end
	end
	ctx.StartCount = ctx:AliveCount()
	state:SetAttribute("Alive", ctx.StartCount)
	state:SetAttribute("Total", ctx.StartCount)

	Util.Announce(minigame.Title, GOLD, 1.5)
	task.wait(1)
	for n = Config.Round.Countdown, 1, -1 do
		Util.Announce(tostring(n), Color3.new(1, 1, 1), 0.9)
		task.wait(1)
	end
	for player in ctx.Alive do
		setAnchored(player, false)
	end
	Util.Announce("ВПЕРЁД!", GREEN, 1.2)

	ctx:SetEndsAt(Net.Now() + minigame.Duration)
	setPhase("Playing")
	state:SetAttribute("EndsAt", ctx.EndsAt)

	task.spawn(function()
		local runOk, err = pcall(minigame.Run, ctx)
		if not runOk then
			warn("[AzartArena] Ошибка мини-игры", minigame.Id, err)
		end
	end)

	while true do
		task.wait(0.2)
		checkFalls(ctx)
		if shouldEnd(ctx) then
			break
		end
	end
	ctx.Ended = true

	setPhase("Results", Config.Round.Results)
	awardResults(ctx)

	task.wait(2.5)
	for _, player in ctx.Participants do
		if player.Parent then
			removeArenaTools(player)
			player:SetAttribute("InRound", false)
			if Util.IsAlive(player) and player.Character == ctx.Characters[player] then
				setAnchored(player, false)
				Util.ResetMovement(player)
				Util.TeleportToLobby(player)
			end
		end
	end
	ctx.Folder:Destroy()
	task.wait(math.max(0, Config.Round.Results - 2.5))
end

function RoundManager.Start()
	-- если игрок появился, пока идёт раунд, он просто ждёт в лобби
	task.spawn(function()
		while true do
			if #Players:GetPlayers() < Config.Round.MinPlayers then
				setPhase("Waiting")
				task.wait(1)
				continue
			end

			local minigame = pickMinigame(#Players:GetPlayers())
			state:SetAttribute("Next", minigame.Title)
			state:SetAttribute("NextDesc", minigame.Description)
			setPhase("Intermission", Config.Round.Intermission)
			Betting.Open()
			Util.NotifyAll("⏳ Следующая игра: " .. minigame.Title .. ". Делай ставки!", "info")

			local deadline = Net.Now() + Config.Round.Intermission
			while Net.Now() < deadline do
				task.wait(0.25)
			end
			Betting.Close()

			local ok, err = pcall(runRound, minigame)
			if not ok then
				warn("[AzartArena] Ошибка раунда:", err)
				local arena = workspace:FindFirstChild("Arena")
				if arena then
					arena:Destroy()
				end
				for _, player in Players:GetPlayers() do
					player:SetAttribute("InRound", false)
					removeArenaTools(player)
					if Util.IsAlive(player) then
						setAnchored(player, false)
						Util.ResetMovement(player)
						Util.TeleportToLobby(player)
					end
				end
				Betting.RefundAll()
				task.wait(3)
			end
		end
	end)
end

return RoundManager
