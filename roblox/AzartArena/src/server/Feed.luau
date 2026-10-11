-- Табло лидеров сервера и лента крупных выигрышей.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Data = require(script.Parent.Data)
local Util = require(script.Parent.Util)

local Feed = {}

local leaderboardLabel: TextLabel? = nil
local feedLabel: TextLabel? = nil
local entries: { string } = {}

local MEDALS = { "🥇", "🥈", "🥉" }

local function escape(text: string): string
	text = string.gsub(text, "&", "&amp;")
	text = string.gsub(text, "<", "&lt;")
	text = string.gsub(text, ">", "&gt;")
	return text
end

local function refreshLeaderboard()
	if not leaderboardLabel then
		return
	end
	local list = {}
	for _, player in Players:GetPlayers() do
		local profile = Data.Get(player)
		if profile then
			table.insert(list, { Name = player.DisplayName, Coins = profile.Coins, Wins = profile.Wins })
		end
	end
	table.sort(list, function(a, b)
		return a.Coins > b.Coins
	end)
	local lines = {}
	for i = 1, math.min(#list, 10) do
		local row = list[i]
		local rank = Config.GetRank(row.Coins)
		table.insert(
			lines,
			string.format(
				'%s %s <font color="#FFC83C">%s 💰</font>  <font color="#9AE6FF">🏆%d</font>  %s',
				MEDALS[i] or (i .. "."),
				escape(row.Name),
				Config.Format(row.Coins),
				row.Wins,
				rank.Icon
			)
		)
	end
	if #lines == 0 then
		lines = { "Загрузка..." }
	end
	leaderboardLabel.Text = table.concat(lines, "\n")
end

local function refreshFeed()
	if feedLabel then
		feedLabel.Text = #entries > 0 and table.concat(entries, "\n") or "Пока пусто... стань первым!"
	end
end

-- Сообщает о выигрыше: крупные попадают в ленту и в уведомления всем.
function Feed.Report(player: Player, amount: number, source: string, multiplier: number?)
	Data.RecordWin(player, amount)
	local big = amount >= 1000 or (multiplier ~= nil and multiplier >= Config.Slots.BigWinMultiplier)
	if not big then
		return
	end
	local text = string.format("%s — %s: +%s 💰", player.DisplayName, source, Config.Format(amount))
	if multiplier and multiplier > 1 then
		text ..= string.format(" (x%d)", multiplier)
	end
	Util.NotifyAll("🔥 " .. text, "bigwin")
	table.insert(entries, 1, string.format('<font color="#FF8AD8">%s</font>', escape(text)))
	while #entries > 9 do
		table.remove(entries)
	end
	refreshFeed()
end

function Feed.Init(leaderboard: TextLabel, feed: TextLabel)
	leaderboardLabel = leaderboard
	feedLabel = feed
	refreshFeed()
	task.spawn(function()
		while true do
			refreshLeaderboard()
			task.wait(3)
		end
	end)
end

return Feed
