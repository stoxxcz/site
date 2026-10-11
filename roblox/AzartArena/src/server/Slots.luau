-- Игровые автоматы. Результат считается на сервере, клиент только показывает анимацию.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Data = require(script.Parent.Data)
local Feed = require(script.Parent.Feed)
local Util = require(script.Parent.Util)

local Slots = {}

local SYMBOLS = Config.Slots.Symbols
local busy: { [Player]: boolean } = {}

local function rollSymbol(): number
	local total = 0
	for _, symbol in SYMBOLS do
		total += symbol.Weight
	end
	local roll = math.random() * total
	for i, symbol in SYMBOLS do
		roll -= symbol.Weight
		if roll <= 0 then
			return i
		end
	end
	return 1
end

local function multiplierFor(a: number, b: number, c: number): number
	if a == b and b == c then
		return SYMBOLS[a].Triple
	end
	if a == b or b == c or a == c then
		return Config.Slots.PairMultiplier
	end
	return 0
end

local function randomIcons(): string
	return string.format(
		"%s %s %s",
		SYMBOLS[math.random(#SYMBOLS)].Icon,
		SYMBOLS[math.random(#SYMBOLS)].Icon,
		SYMBOLS[math.random(#SYMBOLS)].Icon
	)
end

local function spin(player: Player, machine)
	if busy[player] then
		return
	end
	local stake = machine.Config.Stake
	if not Data.TrySpend(player, stake) then
		Util.Notify(player, string.format("Не хватает монет: ставка %s 💰", Config.Format(stake)), "error")
		return
	end
	busy[player] = true

	local a, b, c = rollSymbol(), rollSymbol(), rollSymbol()
	local multiplier = multiplierFor(a, b, c)
	local payout = math.floor(stake * multiplier)
	local icons = { SYMBOLS[a].Icon, SYMBOLS[b].Icon, SYMBOLS[c].Icon }

	Net.Event("SlotResult"):FireClient(player, machine.Config.Id, icons, payout, stake, multiplier)

	-- анимация экрана автомата для зрителей
	task.spawn(function()
		local started = os.clock()
		while os.clock() - started < Config.Slots.SpinTime - 0.2 do
			machine.ReelsLabel.Text = randomIcons()
			task.wait(0.1)
		end
		machine.ReelsLabel.Text = table.concat(icons, " ")
		if multiplier >= 5 then
			local top = machine.Top
			local original = top.Color
			for _ = 1, 6 do
				top.Color = Color3.new(1, 1, 1)
				task.wait(0.12)
				top.Color = original
				task.wait(0.12)
			end
		end
	end)

	task.delay(Config.Slots.SpinTime, function()
		busy[player] = nil
		if payout > 0 and player.Parent then
			Data.AddCoins(player, payout)
			if multiplier >= 5 then
				Feed.Report(player, payout, "слоты " .. machine.Config.Name, multiplier)
			end
			if multiplier >= Config.Slots.BigWinMultiplier then
				Util.PlaySoundAt(machine.Top.Position, Util.Sounds.Ping, 1, 0.8)
			end
		end
	end)
end

function Slots.Init(machines)
	for _, machine in machines do
		machine.Prompt.Triggered:Connect(function(player: Player)
			spin(player, machine)
		end)
		-- лёгкое мигание верхней лампы
		local info = TweenInfo.new(1.2, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
		TweenService:Create(machine.Top, info, { Transparency = 0.25 }):Play()
	end
	game:GetService("Players").PlayerRemoving:Connect(function(player)
		busy[player] = nil
	end)
end

return Slots
