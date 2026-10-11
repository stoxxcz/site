-- Плавное вращение колеса рулетки и декоративных деталей (делается на клиенте).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Net = require(ReplicatedStorage.Shared.Net)
local Sounds = require(script.Parent.Sounds)

local WheelView = {}

local TAU = math.pi * 2

local function setupWheel()
	local lobby = Workspace:WaitForChild("Lobby")
	local rouletteFolder = lobby:WaitForChild("Roulette")
	local wheel = rouletteFolder:WaitForChild("Wheel")
	local base = wheel:GetAttribute("Base")
	local count = wheel:GetAttribute("Segments")
	if typeof(base) ~= "CFrame" or type(count) ~= "number" then
		return
	end
	local segAngle = TAU / count

	local offsets: { [BasePart]: CFrame } = {}
	local function collect()
		for _, part in wheel:GetDescendants() do
			if part:IsA("BasePart") and not offsets[part] then
				offsets[part] = base:ToObjectSpace(part.CFrame)
			end
		end
	end
	collect()

	local angle = 0
	local function apply(a: number)
		local cf = base * CFrame.Angles(0, 0, -a)
		for part, offset in offsets do
			part.CFrame = cf * offset
		end
	end

	local connection: RBXScriptConnection? = nil
	Net.Event("RouletteSpin").OnClientEvent:Connect(function(index: number, offset: number, _color: string, spinTime: number)
		collect()
		if connection then
			connection:Disconnect()
		end
		local target = (-(index - 1) * segAngle + offset * segAngle) % TAU
		local current = angle % TAU
		local diff = (target - current) % TAU
		local startAngle = angle
		local finalAngle = angle + 5 * TAU + diff
		local started = os.clock()
		local duration = math.max(1, spinTime - 0.8)
		local lastSeg = math.floor(angle / segAngle)
		connection = RunService.RenderStepped:Connect(function()
			local t = math.clamp((os.clock() - started) / duration, 0, 1)
			local eased = 1 - (1 - t) ^ 4
			angle = startAngle + (finalAngle - startAngle) * eased
			apply(angle)
			local seg = math.floor(angle / segAngle)
			if seg ~= lastSeg then
				lastSeg = seg
				local camera = Workspace.CurrentCamera
				if camera and (camera.CFrame.Position - base.Position).Magnitude < 90 then
					Sounds.Play("Tick", 0.2, 1.6)
				end
			end
			if t >= 1 and connection then
				connection:Disconnect()
				connection = nil
			end
		end)
	end)
end

local function setupSpinners()
	local spinners: { BasePart } = {}
	local function consider(inst: Instance)
		if inst:IsA("BasePart") and inst:GetAttribute("Spin") then
			table.insert(spinners, inst)
		end
	end
	for _, inst in Workspace:GetDescendants() do
		consider(inst)
	end
	Workspace.DescendantAdded:Connect(consider)
	local bases: { [BasePart]: CFrame } = {}
	local elapsed = 0
	RunService.RenderStepped:Connect(function(dt)
		elapsed += dt
		for i = #spinners, 1, -1 do
			local part = spinners[i]
			if not part.Parent then
				table.remove(spinners, i)
			else
				local baseCf = bases[part]
				if not baseCf then
					baseCf = part.CFrame
					bases[part] = baseCf
				end
				local speed = part:GetAttribute("Spin") or 1
				part.CFrame = baseCf * CFrame.Angles(0, elapsed * speed, 0) + Vector3.new(0, math.sin(elapsed * 1.5) * 1.2, 0)
			end
		end
	end)
end

function WheelView.Init()
	task.spawn(setupWheel)
	task.spawn(setupSpinners)
end

return WheelView
