-- Режим зрителя: смотри за теми, кто ещё в игре (и за кем стоят твои ставки).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Net = require(ReplicatedStorage.Shared.Net)
local UI = require(script.Parent.UI)

local player = Players.LocalPlayer
local state = Net.State()

local Spectate = {}

function Spectate.Init(hud)
	local spectating = false
	local index = 1

	local bar = UI.new("Frame", {
		Name = "Spectate",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -84),
		Size = UDim2.fromOffset(440, 54),
		BackgroundColor3 = UI.Colors.Bg,
		BackgroundTransparency = 0.05,
		Visible = false,
		ZIndex = 4,
		Parent = hud.Gui(),
	}, {
		UI.Corner(14),
		UI.Stroke(UI.Colors.Cyan, 2.5),
		UI.new("UIScale"),
	})
	local prev = UI.Button("◀", UI.Colors.Panel2, {
		Size = UDim2.fromOffset(46, 42),
		Position = UDim2.fromOffset(6, 6),
		ZIndex = 5,
		Parent = bar,
	})
	local nameLabel = UI.Label({
		Size = UDim2.new(1, -170, 0, 42),
		Position = UDim2.fromOffset(58, 6),
		Font = UI.FontBlack,
		Text = "",
		ZIndex = 5,
		Parent = bar,
	})
	local nextButton = UI.Button("▶", UI.Colors.Panel2, {
		Size = UDim2.fromOffset(46, 42),
		Position = UDim2.new(1, -106, 0, 6),
		ZIndex = 5,
		Parent = bar,
	})
	local exit = UI.Button("✕", UI.Colors.Bad, {
		Size = UDim2.fromOffset(46, 42),
		Position = UDim2.new(1, -54, 0, 6),
		ZIndex = 5,
		Parent = bar,
	})

	local function candidates(): { Player }
		local list = {}
		for _, other in Players:GetPlayers() do
			if other ~= player and other:GetAttribute("InRound") == true then
				table.insert(list, other)
			end
		end
		return list
	end

	local function ownHumanoid(): Humanoid?
		local character = player.Character
		return character and character:FindFirstChildOfClass("Humanoid")
	end

	local function stop()
		spectating = false
		bar.Visible = false
		local camera = Workspace.CurrentCamera
		local humanoid = ownHumanoid()
		if camera and humanoid then
			camera.CameraSubject = humanoid
		end
	end

	local function show()
		local list = candidates()
		if #list == 0 then
			stop()
			return
		end
		index = (index - 1) % #list + 1
		local target = list[index]
		local character = target.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local camera = Workspace.CurrentCamera
		if humanoid and camera then
			camera.CameraSubject = humanoid
			nameLabel.Text = "👁 " .. target.DisplayName
		end
	end

	local button = hud.AddMenuButton("spectate", "👁", "Смотреть", UI.Colors.Cyan, 5, function()
		if spectating then
			stop()
		else
			spectating = true
			bar.Visible = true
			hud.ClosePanel()
			show()
		end
	end)
	button.Visible = false

	prev.Activated:Connect(function()
		index -= 1
		show()
	end)
	nextButton.Activated:Connect(function()
		index += 1
		show()
	end)
	exit.Activated:Connect(stop)

	player.CharacterAdded:Connect(function()
		if spectating then
			task.wait(0.3)
			show()
		end
	end)

	task.defer(function()
		local scale = bar:FindFirstChildOfClass("UIScale")
		local status = hud.Gui():FindFirstChild("Status")
		local source = status and status:FindFirstChildOfClass("UIScale")
		if scale and source then
			scale.Scale = source.Scale
			source:GetPropertyChangedSignal("Scale"):Connect(function()
				scale.Scale = source.Scale
			end)
		end
	end)

	task.spawn(function()
		while true do
			local canWatch = state:GetAttribute("Phase") == "Playing" and player:GetAttribute("InRound") ~= true
			button.Visible = canWatch
			if spectating then
				if not canWatch then
					stop()
				else
					local camera = Workspace.CurrentCamera
					local subject = camera and camera.CameraSubject
					local list = candidates()
					local watchingValid = false
					for _, other in list do
						local character = other.Character
						if subject and character and subject:IsDescendantOf(character) then
							watchingValid = true
						end
					end
					if not watchingValid then
						show()
					end
				end
			end
			task.wait(0.4)
		end
	end)
end

return Spectate
