-- Рулетка: приём ставок -> вращение -> выплаты. Крутится сама по кругу.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Data = require(script.Parent.Data)
local Feed = require(script.Parent.Feed)
local Util = require(script.Parent.Util)

local Roulette = {}

local RC = Config.Roulette
local state = Net.State()

-- player -> color -> amount
local bets: { [Player]: { [string]: number } } = {}
local phase = "Betting"
local history: { string } = {}

local function totals(): { [string]: number }
	local result = { red = 0, black = 0, green = 0 }
	for _, colors in bets do
		for color, amount in colors do
			result[color] += amount
		end
	end
	return result
end

local function publishTotals()
	state:SetAttribute("RouletteTotals", HttpService:JSONEncode(totals()))
end

local function sendMine(player: Player)
	Net.Event("RouletteMyBets"):FireClient(player, bets[player] or {})
end

local function setPhase(newPhase: string, duration: number)
	phase = newPhase
	state:SetAttribute("RoulettePhase", newPhase)
	state:SetAttribute("RouletteEndsAt", Net.Now() + duration)
end

local function runBoard(label: TextLabel)
	task.spawn(function()
		while true do
			local left = math.max(0, math.ceil((state:GetAttribute("RouletteEndsAt") or 0) - Net.Now()))
			if phase == "Betting" then
				label.Text = string.format('🎡 РУЛЕТКА\n<font color="#FFFFFF">Ставки: %d с</font>', left)
			elseif phase == "Spinning" then
				label.Text = '🎡 РУЛЕТКА\n<font color="#FF8AD8">Крутим!</font>'
			else
				local last = history[1]
				local info = last and RC.Colors[last]
				label.Text = info and string.format("🎡 Выпало:\n%s %s", info.Icon, info.Name) or "🎡 РУЛЕТКА"
			end
			task.wait(0.5)
		end
	end)
end

local function payout(color: string)
	local info = RC.Colors[color]
	for player, colors in bets do
		if player.Parent then
			local won = (colors[color] or 0) * info.Multiplier
			local stake = 0
			for _, amount in colors do
				stake += amount
			end
			if won > 0 then
				Data.AddCoins(player, won)
				Util.Notify(player, string.format("🎡 %s %s! Выигрыш +%s 💰", info.Icon, info.Name, Config.Format(won)), "success")
				Feed.Report(player, won, "рулетка", info.Multiplier >= 14 and info.Multiplier or nil)
			elseif stake > 0 then
				Util.Notify(player, string.format("🎡 %s %s. Ставка %s 💰 сгорела", info.Icon, info.Name, Config.Format(stake)), "error")
			end
		end
	end
	bets = {}
	for _, player in Players:GetPlayers() do
		sendMine(player)
	end
	publishTotals()
end

local function loop()
	while true do
		setPhase("Betting", RC.BetTime)
		publishTotals()
		task.wait(RC.BetTime)

		local index = math.random(#RC.Segments)
		local color = RC.Segments[index]
		local offset = (math.random() - 0.5) * 0.7
		setPhase("Spinning", RC.SpinTime)
		Net.Event("RouletteSpin"):FireAllClients(index, offset, color, RC.SpinTime)
		task.wait(RC.SpinTime)

		table.insert(history, 1, color)
		while #history > 12 do
			table.remove(history)
		end
		state:SetAttribute("RouletteHistory", table.concat(history, ","))
		setPhase("Result", RC.ResultTime)
		payout(color)
		task.wait(RC.ResultTime)
	end
end

function Roulette.SendTo(player: Player)
	sendMine(player)
end

function Roulette.Init(boardLabel: TextLabel)
	Net.Event("RouletteBet").OnServerEvent:Connect(function(player: Player, color: any, amount: any)
		if type(color) ~= "string" or type(amount) ~= "number" or not RC.Colors[color] then
			return
		end
		if amount ~= amount or amount == math.huge then
			return
		end
		amount = math.floor(amount)
		if phase ~= "Betting" then
			Util.Notify(player, "⛔ Колесо уже крутится — жди следующий круг", "error")
			return
		end
		if amount < RC.MinBet then
			Util.Notify(player, string.format("Минимальная ставка: %d 💰", RC.MinBet), "error")
			return
		end
		if not Data.TrySpend(player, amount) then
			Util.Notify(player, "Не хватает монет!", "error")
			return
		end
		local colors = bets[player]
		if not colors then
			colors = {}
			bets[player] = colors
		end
		colors[color] = (colors[color] or 0) + amount
		sendMine(player)
		publishTotals()
	end)

	runBoard(boardLabel)
	task.spawn(loop)
end

return Roulette
