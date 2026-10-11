-- Дуэли в монетку 1 на 1: оба ставят одинаково, победитель забирает всё.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Data = require(script.Parent.Data)
local Feed = require(script.Parent.Feed)
local Util = require(script.Parent.Util)

local Duels = {}

type Invite = { From: Player, To: Player, Amount: number }

local invites: { [string]: Invite } = {}
local outgoing: { [Player]: string } = {}
local flipping: { [Player]: boolean } = {}
local counter = 0

local function onRequest(player: Player, targetUserId: any, amount: any)
	if type(targetUserId) ~= "number" or type(amount) ~= "number" then
		return
	end
	if amount ~= amount or amount == math.huge then
		return
	end
	amount = math.floor(amount)
	local target = Players:GetPlayerByUserId(targetUserId)
	if not target or target == player then
		return
	end
	if amount < Config.Duel.MinBet then
		Util.Notify(player, string.format("Минимальная ставка: %d 💰", Config.Duel.MinBet), "error")
		return
	end
	if outgoing[player] then
		Util.Notify(player, "Ты уже ждёшь ответа на вызов", "error")
		return
	end
	if Data.GetCoins(player) < amount then
		Util.Notify(player, "Не хватает монет!", "error")
		return
	end
	if Data.GetCoins(target) < amount then
		Util.Notify(player, string.format("У %s нет столько монет", target.DisplayName), "error")
		return
	end

	counter += 1
	local id = tostring(counter)
	invites[id] = { From = player, To = target, Amount = amount }
	outgoing[player] = id
	Net.Event("DuelInvite"):FireClient(target, id, player.DisplayName, amount, Config.Duel.InviteTimeout)
	Util.Notify(player, string.format("⚔️ Вызов отправлен %s на %s 💰", target.DisplayName, Config.Format(amount)), "info")

	task.delay(Config.Duel.InviteTimeout, function()
		if invites[id] then
			invites[id] = nil
			if outgoing[player] == id then
				outgoing[player] = nil
			end
			if player.Parent then
				Util.Notify(player, string.format("⌛ %s не ответил на вызов", target.DisplayName), "error")
			end
		end
	end)
end

local function onRespond(player: Player, id: any, accept: any)
	if type(id) ~= "string" then
		return
	end
	local invite = invites[id]
	if not invite or invite.To ~= player then
		return
	end
	invites[id] = nil
	if outgoing[invite.From] == id then
		outgoing[invite.From] = nil
	end
	local challenger = invite.From
	local amount = invite.Amount

	if accept ~= true then
		if challenger.Parent then
			Util.Notify(challenger, string.format("🙅 %s отказался от дуэли", player.DisplayName), "error")
		end
		return
	end
	if not challenger.Parent then
		return
	end
	if flipping[challenger] or flipping[player] then
		Util.Notify(player, "Кто-то из вас уже в дуэли", "error")
		return
	end
	if Data.GetCoins(challenger) < amount or Data.GetCoins(player) < amount then
		Util.Notify(player, "У кого-то не хватает монет — дуэль отменена", "error")
		Util.Notify(challenger, "У кого-то не хватает монет — дуэль отменена", "error")
		return
	end
	Data.TrySpend(challenger, amount)
	Data.TrySpend(player, amount)
	flipping[challenger] = true
	flipping[player] = true

	local challengerWins = math.random() < 0.5
	local winner = challengerWins and challenger or player
	local loser = challengerWins and player or challenger
	for _, participant in { challenger, player } do
		Net.Event("DuelResult"):FireClient(participant, {
			Challenger = challenger.DisplayName,
			Opponent = player.DisplayName,
			Winner = winner.DisplayName,
			Amount = amount,
			YouWon = participant == winner,
			ChallengerWins = challengerWins,
			FlipTime = Config.Duel.FlipTime,
		})
	end

	task.delay(Config.Duel.FlipTime, function()
		flipping[challenger] = nil
		flipping[player] = nil
		local prize = amount * 2
		if winner.Parent then
			Data.AddCoins(winner, prize)
			Util.Notify(winner, string.format("🪙 Победа в дуэли! +%s 💰", Config.Format(prize)), "success")
		end
		if loser.Parent then
			Util.Notify(loser, string.format("🪙 Дуэль проиграна: -%s 💰", Config.Format(amount)), "error")
		end
		if amount >= 500 then
			Util.NotifyAll(
				string.format("🪙 %s обыграл %s в монетку на %s 💰!", winner.DisplayName, loser.DisplayName, Config.Format(amount)),
				"bigwin"
			)
		end
		if winner.Parent then
			Feed.Report(winner, prize, "дуэль")
		end
	end)
end

function Duels.Init()
	Net.Event("DuelRequest").OnServerEvent:Connect(onRequest)
	Net.Event("DuelRespond").OnServerEvent:Connect(onRespond)
	Players.PlayerRemoving:Connect(function(player)
		outgoing[player] = nil
		flipping[player] = nil
		for id, invite in invites do
			if invite.From == player or invite.To == player then
				invites[id] = nil
			end
		end
	end)
end

return Duels
