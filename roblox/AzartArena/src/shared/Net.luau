-- Сетевые события и общее состояние игры (атрибуты папки GameState).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local EVENTS = {
	"Notify",
	"Announce",
	"PlaceBet",
	"BetUpdate",
	"SlotResult",
	"RouletteBet",
	"RouletteSpin",
	"RouletteMyBets",
	"DuelRequest",
	"DuelInvite",
	"DuelRespond",
	"DuelResult",
	"ShopAction",
	"ShopState",
	"ClaimWelfare",
	"Knockback",
	"RequestSync",
}

local Net = {}

local remotes: Instance
local state: Instance

if RunService:IsServer() then
	local existing = ReplicatedStorage:FindFirstChild("Remotes")
	if existing then
		remotes = existing
	else
		local folder = Instance.new("Folder")
		folder.Name = "Remotes"
		for _, name in EVENTS do
			local event = Instance.new("RemoteEvent")
			event.Name = name
			event.Parent = folder
		end
		folder.Parent = ReplicatedStorage
		remotes = folder
	end

	local existingState = ReplicatedStorage:FindFirstChild("GameState")
	if existingState then
		state = existingState
	else
		local folder = Instance.new("Folder")
		folder.Name = "GameState"
		folder:SetAttribute("Phase", "Waiting")
		folder:SetAttribute("Title", "")
		folder:SetAttribute("Desc", "")
		folder:SetAttribute("Next", "")
		folder:SetAttribute("NextDesc", "")
		folder:SetAttribute("EndsAt", 0)
		folder:SetAttribute("Alive", 0)
		folder:SetAttribute("Total", 0)
		folder:SetAttribute("Jackpot", 0)
		folder:SetAttribute("BetsOpen", false)
		folder:SetAttribute("RoulettePhase", "Betting")
		folder:SetAttribute("RouletteEndsAt", 0)
		folder:SetAttribute("RouletteHistory", "")
		folder:SetAttribute("RouletteTotals", "{}")
		folder.Parent = ReplicatedStorage
		state = folder
	end
else
	remotes = ReplicatedStorage:WaitForChild("Remotes")
	state = ReplicatedStorage:WaitForChild("GameState")
end

function Net.Event(name: string): RemoteEvent
	return remotes:WaitForChild(name) :: RemoteEvent
end

function Net.State(): Instance
	return state
end

function Net.Now(): number
	return workspace:GetServerTimeNow()
end

return Net
