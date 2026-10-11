-- Тотализатор: в перерыве игроки ставят монеты на того, кто выиграет раунд.
-- Банк делится между угадавшими пропорционально ставкам. Никто не угадал — всё уходит в джекпот.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Data = require(script.Parent.Data)
local Feed = require(script.Parent.Feed)
local Util = require(script.Parent.Util)

local Betting = {}

-- bettor -> (targetUserId -> amount)
local bets: { [Player]: { [number]: number } } = {}
local isOpen = false
local state = Net.State()

local function summary(): ({ [string]: number }, number)
	local pools: { [string]: number } = {}
	local total = 0
	for _, targets in bets do
		for userId, amount in targets do
			local key = tostring(userId)
			pools[key] = (pools[key] or 0) + amount
			total += amount
		end
	end
	return pools, total
end

local function sendTo(player: Player, pools: { [string]: number }, total: number)
	local mine: { [string]: number } = {}
	local targets = bets[player]
	if targets then
		for userId, amount in targets do
			mine[tostring(userId)] = amount
		end
	end
	Net.Event("BetUpdate"):FireClient(player, pools, mine, total)
end

function Betting.Broadcast()
	local pools, total = summary()
	for _, player in Players:GetPlayers() do
		sendTo(player, pools, total)
	end
end

function Betting.SendTo(player: Player)
	local pools, total = summary()
	sendTo(player, pools, total)
end

function Betting.Open()
	isOpen = true
	state:SetAttribute("BetsOpen", true)
	Betting.Broadcast()
end

function Betting.Close()
	isOpen = false
	state:SetAttribute("BetsOpen", false)
end

local function refund(bettor: Player, amount: number)
	if bettor.Parent and amount > 0 then
		Data.AddCoins(bettor, amount)
	end
end

-- Возвращает ставки на тех, кто не участвует в раунде.
function Betting.Lock(participants: { Player })
	local inRound: { [number]: boolean } = {}
	for _, player in participants do
		inRound[player.UserId] = true
	end
	for bettor, targets in bets do
		for userId, amount in targets do
			if not inRound[userId] then
				targets[userId] = nil
				refund(bettor, amount)
				Util.Notify(bettor, "↩️ Ставка возвращена: игрок не участвует в раунде", "info")
			end
		end
	end
	Betting.Broadcast()
end

function Betting.RefundAll()
	for bettor, targets in bets do
		local sum = 0
		for _, amount in targets do
			sum += amount
		end
		refund(bettor, sum)
	end
	bets = {}
	Betting.Broadcast()
end

function Betting.Resolve(winners: { Player })
	local winnerIds: { [number]: boolean } = {}
	for _, player in winners do
		winnerIds[player.UserId] = true
	end

	local totalStakes, winningStakes = 0, 0
	for _, targets in bets do
		for userId, amount in targets do
			totalStakes += amount
			if winnerIds[userId] then
				winningStakes += amount
			end
		end
	end
	if totalStakes == 0 then
		return
	end

	local jackpot = state:GetAttribute("Jackpot") or 0
	if winningStakes == 0 then
		jackpot += totalStakes
		state:SetAttribute("Jackpot", jackpot)
		for bettor in bets do
			if bettor.Parent then
				Util.Notify(bettor, "🎲 Ставка не сыграла...", "error")
			end
		end
		Util.NotifyAll(string.format("🎰 Никто не угадал! Джекпот вырос до %s 💰", Config.Format(jackpot)), "bigwin")
	else
		local pool = math.floor(totalStakes * Config.Betting.HouseBonus) + jackpot
		for bettor, targets in bets do
			local mine = 0
			for userId, amount in targets do
				if winnerIds[userId] then
					mine += amount
				end
			end
			if bettor.Parent then
				if mine > 0 then
					local payout = math.floor(pool * mine / winningStakes)
					Data.AddCoins(bettor, payout)
					Util.Notify(bettor, string.format("🎲 Ставка сыграла! +%s 💰", Config.Format(payout)), "success")
					Feed.Report(bettor, payout, "ставка на раунд")
				else
					Util.Notify(bettor, "🎲 Ставка не сыграла...", "error")
				end
			end
		end
		if jackpot > 0 then
			Util.NotifyAll(string.format("💥 ДЖЕКПОТ %s 💰 сорван!", Config.Format(jackpot)), "bigwin")
		end
		state:SetAttribute("Jackpot", 0)
	end
	bets = {}
	Betting.Broadcast()
end

function Betting.Init()
	state:SetAttribute("Jackpot", Config.Betting.StartJackpot)

	Net.Event("PlaceBet").OnServerEvent:Connect(function(player: Player, targetUserId: any, amount: any)
		if type(targetUserId) ~= "number" or type(amount) ~= "number" then
			return
		end
		if amount ~= amount or amount == math.huge then
			return
		end
		amount = math.floor(amount)
		if not isOpen then
			Util.Notify(player, "⛔ Ставки сейчас закрыты — дождись перерыва", "error")
			return
		end
		if amount < Config.Betting.MinBet then
			Util.Notify(player, string.format("Минимальная ставка: %d 💰", Config.Betting.MinBet), "error")
			return
		end
		local target = Players:GetPlayerByUserId(targetUserId)
		if not target then
			return
		end
		if not Data.TrySpend(player, amount) then
			Util.Notify(player, "Не хватает монет!", "error")
			return
		end
		local targets = bets[player]
		if not targets then
			targets = {}
			bets[player] = targets
		end
		targets[targetUserId] = (targets[targetUserId] or 0) + amount
		Util.Notify(player, string.format("✅ Ставка %s 💰 на %s принята", Config.Format(amount), target.DisplayName), "success")
		if target ~= player and amount >= 100 then
			Util.Notify(target, string.format("👀 %s поставил на тебя %s 💰!", player.DisplayName, Config.Format(amount)), "info")
		end
		Betting.Broadcast()
	end)

	Players.PlayerAdded:Connect(function()
		Betting.Broadcast()
	end)
	Players.PlayerRemoving:Connect(function()
		task.defer(Betting.Broadcast)
	end)
end

return Betting
