-- Магазин следов и пособие для банкротов.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Net = require(ReplicatedStorage.Shared.Net)
local Data = require(script.Parent.Data)
local Util = require(script.Parent.Util)

local Shop = {}

function Shop.SendState(player: Player)
	local profile = Data.Get(player)
	if not profile then
		return
	end
	local owned = {}
	for id in profile.Owned do
		table.insert(owned, id)
	end
	Net.Event("ShopState"):FireClient(player, owned, profile.Equipped)
end

function Shop.Init()
	Net.Event("ShopAction").OnServerEvent:Connect(function(player: Player, action: any, itemId: any)
		if type(action) ~= "string" or type(itemId) ~= "string" then
			return
		end
		local profile = Data.Get(player)
		if not profile then
			return
		end
		if action == "buy" then
			local item = Config.GetTrail(itemId)
			if not item or profile.Owned[itemId] then
				return
			end
			if not Data.TrySpend(player, item.Price) then
				Util.Notify(player, string.format("Не хватает монет: нужно %s 💰", Config.Format(item.Price)), "error")
				return
			end
			Data.SetOwned(player, itemId)
			Data.SetEquipped(player, itemId)
			Util.Notify(player, string.format("🛒 Куплен след «%s»!", item.Name), "success")
			if item.Price >= 15000 then
				Util.NotifyAll(string.format("✨ %s купил %s след!", player.DisplayName, item.Name), "bigwin")
			end
		elseif action == "equip" then
			if itemId == "" or profile.Owned[itemId] then
				Data.SetEquipped(player, itemId)
			end
		end
		Shop.SendState(player)
	end)

	Data.Loaded:Connect(Shop.SendState)

	Net.Event("ClaimWelfare").OnServerEvent:Connect(function(player: Player)
		local profile = Data.Get(player)
		if not profile then
			return
		end
		if profile.Coins >= Config.Welfare.Threshold then
			Util.Notify(player, "Пособие только для тех, у кого меньше " .. Config.Welfare.Threshold .. " 💰", "error")
			return
		end
		local now = os.clock()
		local wait = Config.Welfare.Cooldown - (now - profile.LastWelfare)
		if profile.LastWelfare > 0 and wait > 0 then
			Util.Notify(player, string.format("💸 Пособие будет доступно через %d с", math.ceil(wait)), "error")
			return
		end
		profile.LastWelfare = now
		Data.AddCoins(player, Config.Welfare.Amount)
		Util.Notify(player, string.format("💸 Пособие +%d 💰. Не проиграй всё сразу!", Config.Welfare.Amount), "success")
	end)
end

return Shop
