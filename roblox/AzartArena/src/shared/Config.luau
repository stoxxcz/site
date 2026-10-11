-- Все настройки игры в одном месте. Меняй числа здесь, чтобы подкрутить баланс.

local Config = {}

Config.GameName = "АЗАРТ АРЕНА"
Config.DataStoreName = "AzartArena_Data_v1"
Config.StartCoins = 250

Config.LobbySpawn = Vector3.new(0, 4, 20)
Config.ArenaOrigin = Vector3.new(0, 300, 900)

Config.Round = {
	MinPlayers = 1,
	Intermission = 25, -- перерыв между раундами (время на ставки)
	Countdown = 3,
	Results = 7,
}

Config.Rewards = {
	Participation = 10, -- каждому участнику раунда
	SoloSurvivor = 150, -- единственному выжившему
	Survivor = 80, -- каждому выжившему, если их несколько
	RacePlaces = { 150, 100, 75 }, -- места в гонках
	RaceFinisher = 50, -- остальным финишировавшим
}

Config.Betting = {
	MinBet = 10,
	HouseBonus = 1.25, -- казино докидывает +25% к банку ставок
	StartJackpot = 200,
}

Config.Welfare = {
	Threshold = 25, -- если монет меньше — можно взять пособие
	Amount = 120,
	Cooldown = 90,
}

Config.Slots = {
	SpinTime = 2.6,
	PairMultiplier = 1, -- два одинаковых символа = возврат ставки
	BigWinMultiplier = 25,
	Machines = {
		{ Id = 1, Name = "МИНИ", Stake = 10, Color = Color3.fromRGB(40, 140, 255) },
		{ Id = 2, Name = "КЛАССИКА", Stake = 100, Color = Color3.fromRGB(170, 60, 255) },
		{ Id = 3, Name = "ХАЙРОЛЛЕР", Stake = 1000, Color = Color3.fromRGB(255, 185, 30) },
	},
	Symbols = {
		{ Icon = "🍒", Weight = 30, Triple = 5 },
		{ Icon = "🍋", Weight = 25, Triple = 8 },
		{ Icon = "🍇", Weight = 20, Triple = 15 },
		{ Icon = "🔔", Weight = 12, Triple = 30 },
		{ Icon = "💎", Weight = 8, Triple = 75 },
		{ Icon = "👑", Weight = 5, Triple = 200 },
	},
}

Config.Roulette = {
	BetTime = 20,
	SpinTime = 7,
	ResultTime = 4,
	MinBet = 10,
	-- порядок секторов на колесе (1 = верх в начале)
	Segments = {
		"green", "red", "black", "red", "black", "red", "black", "red",
		"black", "red", "black", "red", "black", "red", "black",
	},
	Colors = {
		red = { Name = "КРАСНОЕ", Multiplier = 2, Color = Color3.fromRGB(220, 40, 55), Icon = "🔴" },
		black = { Name = "ЧЁРНОЕ", Multiplier = 2, Color = Color3.fromRGB(28, 28, 34), Icon = "⚫" },
		green = { Name = "ЗЕЛЁНОЕ", Multiplier = 14, Color = Color3.fromRGB(30, 190, 80), Icon = "🟢" },
	},
	ColorOrder = { "red", "black", "green" },
}

Config.Duel = {
	MinBet = 10,
	InviteTimeout = 15,
	FlipTime = 3.2,
}

Config.Trails = {
	{ Id = "neon", Name = "Неоновый", Price = 500, Colors = { Color3.fromRGB(0, 255, 255), Color3.fromRGB(0, 120, 255) } },
	{ Id = "fire", Name = "Огненный", Price = 2000, Colors = { Color3.fromRGB(255, 240, 80), Color3.fromRGB(255, 120, 0), Color3.fromRGB(255, 20, 0) } },
	{ Id = "toxic", Name = "Токсичный", Price = 5000, Colors = { Color3.fromRGB(200, 255, 0), Color3.fromRGB(0, 200, 60) } },
	{
		Id = "rainbow",
		Name = "Радужный",
		Price = 15000,
		Colors = {
			Color3.fromRGB(255, 0, 0),
			Color3.fromRGB(255, 160, 0),
			Color3.fromRGB(255, 255, 0),
			Color3.fromRGB(0, 220, 0),
			Color3.fromRGB(0, 140, 255),
			Color3.fromRGB(170, 0, 255),
		},
	},
	{ Id = "gold", Name = "Золотой", Price = 50000, Colors = { Color3.fromRGB(255, 240, 150), Color3.fromRGB(255, 190, 0) }, Sparkles = true },
	{ Id = "royal", Name = "Королевский", Price = 250000, Colors = { Color3.fromRGB(150, 0, 255), Color3.fromRGB(255, 200, 0), Color3.fromRGB(150, 0, 255) }, Sparkles = true },
}

Config.Ranks = {
	{ Min = 0, Name = "Новичок", Icon = "🪙", Color = Color3.fromRGB(210, 210, 220) },
	{ Min = 1000, Name = "Игрок", Icon = "🎲", Color = Color3.fromRGB(110, 220, 255) },
	{ Min = 5000, Name = "Хайроллер", Icon = "💵", Color = Color3.fromRGB(110, 255, 140) },
	{ Min = 25000, Name = "Магнат", Icon = "💎", Color = Color3.fromRGB(200, 120, 255) },
	{ Min = 100000, Name = "Король казино", Icon = "👑", Color = Color3.fromRGB(255, 210, 60) },
}

function Config.GetRank(coins: number)
	local best = Config.Ranks[1]
	for _, rank in Config.Ranks do
		if coins >= rank.Min then
			best = rank
		end
	end
	return best
end

function Config.GetTrail(id: string)
	for _, trail in Config.Trails do
		if trail.Id == id then
			return trail
		end
	end
	return nil
end

-- 1234567 -> "1 234 567"
function Config.Format(n: number): string
	n = math.floor(n)
	local digits = tostring(math.abs(n))
	local formatted = (string.gsub(string.reverse(digits), "(%d%d%d)", "%1 "))
	formatted = string.reverse(formatted)
	formatted = (string.gsub(formatted, "^ ", ""))
	if n < 0 then
		formatted = "-" .. formatted
	end
	return formatted
end

function Config.ColorSequenceFrom(colors: { Color3 }): ColorSequence
	if #colors == 1 then
		return ColorSequence.new(colors[1])
	end
	local keypoints = {}
	for i, color in colors do
		table.insert(keypoints, ColorSequenceKeypoint.new((i - 1) / (#colors - 1), color))
	end
	return ColorSequence.new(keypoints)
end

return Config
