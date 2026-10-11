-- Помощники для построения интерфейса из кода.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local UI = {}

UI.Colors = {
	Bg = Color3.fromRGB(20, 16, 34),
	Panel = Color3.fromRGB(32, 26, 54),
	Panel2 = Color3.fromRGB(46, 38, 76),
	Accent = Color3.fromRGB(255, 196, 40),
	Pink = Color3.fromRGB(255, 60, 170),
	Cyan = Color3.fromRGB(40, 220, 255),
	Text = Color3.fromRGB(245, 240, 255),
	Muted = Color3.fromRGB(170, 160, 205),
	Good = Color3.fromRGB(60, 220, 110),
	Bad = Color3.fromRGB(255, 70, 85),
}

UI.Font = Enum.Font.GothamBold
UI.FontBlack = Enum.Font.GothamBlack

function UI.new(className: string, props: { [string]: any }?, children: { Instance }?): any
	local inst = Instance.new(className)
	if props then
		for key, value in props do
			if key ~= "Parent" then
				(inst :: any)[key] = value
			end
		end
	end
	if children then
		for _, child in children do
			child.Parent = inst
		end
	end
	if props and props.Parent then
		inst.Parent = props.Parent
	end
	return inst
end

function UI.Corner(radius: number?): UICorner
	return UI.new("UICorner", { CornerRadius = UDim.new(0, radius or 10) })
end

function UI.Stroke(color: Color3?, thickness: number?, transparency: number?): UIStroke
	return UI.new("UIStroke", {
		Color = color or Color3.new(0, 0, 0),
		Thickness = thickness or 2,
		Transparency = transparency or 0,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	})
end

function UI.TextStroke(thickness: number?): UIStroke
	return UI.new("UIStroke", {
		Color = Color3.new(0, 0, 0),
		Thickness = thickness or 2,
		Transparency = 0.3,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual,
	})
end

function UI.Padding(px: number): UIPadding
	return UI.new("UIPadding", {
		PaddingLeft = UDim.new(0, px),
		PaddingRight = UDim.new(0, px),
		PaddingTop = UDim.new(0, px),
		PaddingBottom = UDim.new(0, px),
	})
end

function UI.List(padding: number?, horizontal: boolean?, align: Enum.HorizontalAlignment?): UIListLayout
	return UI.new("UIListLayout", {
		Padding = UDim.new(0, padding or 6),
		FillDirection = horizontal and Enum.FillDirection.Horizontal or Enum.FillDirection.Vertical,
		HorizontalAlignment = align or Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	})
end

function UI.Gradient(a: Color3, b: Color3, rotation: number?): UIGradient
	return UI.new("UIGradient", {
		Color = ColorSequence.new(a, b),
		Rotation = rotation or 90,
	})
end

function UI.Label(props: { [string]: any }): TextLabel
	local defaults = {
		BackgroundTransparency = 1,
		Font = UI.Font,
		TextColor3 = UI.Colors.Text,
		TextScaled = true,
		RichText = true,
	}
	for key, value in props do
		defaults[key] = value
	end
	return UI.new("TextLabel", defaults)
end

function UI.Button(text: string, color: Color3, props: { [string]: any }?): TextButton
	local base = {
		Text = text,
		BackgroundColor3 = color,
		TextColor3 = Color3.new(1, 1, 1),
		Font = UI.FontBlack,
		TextScaled = true,
		AutoButtonColor = true,
		RichText = true,
	}
	if props then
		for key, value in props do
			base[key] = value
		end
	end
	local button = UI.new("TextButton", base, {
		UI.Corner(10),
		UI.Stroke(color:Lerp(Color3.new(0, 0, 0), 0.45), 2),
		UI.new("UIPadding", {
			PaddingTop = UDim.new(0, 5),
			PaddingBottom = UDim.new(0, 5),
			PaddingLeft = UDim.new(0, 6),
			PaddingRight = UDim.new(0, 6),
		}),
		UI.TextStroke(1.5),
	})
	return button
end

function UI.Tween(inst: Instance, time: number, props: { [string]: any }, style: Enum.EasingStyle?, direction: Enum.EasingDirection?): Tween
	local tween = TweenService:Create(
		inst,
		TweenInfo.new(time, style or Enum.EasingStyle.Quad, direction or Enum.EasingDirection.Out),
		props
	)
	tween:Play()
	return tween
end

-- Модальная панель с заголовком и кнопкой закрытия.
function UI.Panel(parent: Instance, title: string, size: UDim2, accent: Color3)
	local frame = UI.new("Frame", {
		Name = "Panel",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = size,
		BackgroundColor3 = UI.Colors.Bg,
		Visible = false,
		ZIndex = 5,
		Parent = parent,
	}, {
		UI.Corner(16),
		UI.Stroke(accent, 3),
	})
	local header = UI.new("Frame", {
		Name = "Header",
		Size = UDim2.new(1, 0, 0, 50),
		BackgroundColor3 = accent,
		ZIndex = 5,
		Parent = frame,
	}, {
		UI.Corner(16),
		UI.Gradient(accent, accent:Lerp(Color3.new(0, 0, 0), 0.35)),
	})
	-- закрываем нижние скруглённые углы шапки
	UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 16),
		Position = UDim2.new(0, 0, 1, -16),
		BackgroundColor3 = accent:Lerp(Color3.new(0, 0, 0), 0.35),
		BorderSizePixel = 0,
		ZIndex = 5,
		Parent = header,
	})
	UI.Label({
		Text = title,
		Size = UDim2.new(1, -70, 1, -14),
		Position = UDim2.fromOffset(16, 7),
		TextXAlignment = Enum.TextXAlignment.Left,
		Font = UI.FontBlack,
		ZIndex = 6,
		Parent = header,
	})
	local close = UI.Button("✕", UI.Colors.Bad, {
		Size = UDim2.fromOffset(38, 38),
		Position = UDim2.new(1, -46, 0, 6),
		ZIndex = 7,
		Parent = header,
	})
	local content = UI.new("Frame", {
		Name = "Content",
		Size = UDim2.new(1, -24, 1, -66),
		Position = UDim2.fromOffset(12, 58),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Parent = frame,
	})
	return frame, content, close
end

-- Поле ввода суммы с быстрыми кнопками.
function UI.AmountSelector(parent: Instance, default: number, layoutOrder: number?)
	local player = Players.LocalPlayer
	local holder = UI.new("Frame", {
		Name = "Amount",
		Size = UDim2.new(1, 0, 0, 80),
		BackgroundTransparency = 1,
		LayoutOrder = layoutOrder or 0,
		ZIndex = 5,
		Parent = parent,
	})
	UI.Label({
		Text = "Ставка:",
		Size = UDim2.new(0, 80, 0, 34),
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = UI.Colors.Muted,
		ZIndex = 6,
		Parent = holder,
	})
	local box = UI.new("TextBox", {
		Size = UDim2.new(1, -90, 0, 34),
		Position = UDim2.fromOffset(86, 0),
		BackgroundColor3 = UI.Colors.Panel2,
		Text = tostring(default),
		PlaceholderText = "сумма",
		ClearTextOnFocus = false,
		TextColor3 = UI.Colors.Accent,
		Font = UI.FontBlack,
		TextScaled = true,
		ZIndex = 6,
		Parent = holder,
	}, {
		UI.Corner(8),
		UI.new("UIPadding", { PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4) }),
	})
	local chips = UI.new("Frame", {
		Size = UDim2.new(1, 0, 0, 36),
		Position = UDim2.fromOffset(0, 42),
		BackgroundTransparency = 1,
		ZIndex = 6,
		Parent = holder,
	}, {
		UI.new("UIGridLayout", {
			CellSize = UDim2.new(1 / 7, -5, 1, 0),
			CellPadding = UDim2.fromOffset(5, 0),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})

	local function get(): number
		local digits = string.gsub(box.Text, "%D", "")
		return tonumber(digits) or 0
	end
	local function set(value: number)
		box.Text = tostring(math.max(0, math.floor(value)))
	end
	box.FocusLost:Connect(function()
		set(get())
	end)

	local function coins(): number
		return player:GetAttribute("Coins") or 0
	end
	local chipDefs = {
		{ "10", function() set(10) end },
		{ "100", function() set(100) end },
		{ "1K", function() set(1000) end },
		{ "10K", function() set(10000) end },
		{ "½", function() set(get() / 2) end },
		{ "x2", function() set(get() * 2) end },
		{ "ВСЁ", function() set(coins()) end },
	}
	for i, def in chipDefs do
		local chip = UI.Button(def[1], i == #chipDefs and UI.Colors.Pink or UI.Colors.Panel2, {
			LayoutOrder = i,
			ZIndex = 7,
			Parent = chips,
		})
		chip.Activated:Connect(def[2])
	end

	return {
		Frame = holder,
		Get = get,
		Set = set,
	}
end

return UI
