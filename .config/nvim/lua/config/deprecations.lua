-- Mute deprecation warnings triggered from third-party plugins: they're not
-- actionable here and just add startup noise. Warnings from our own config
-- (~/.config/nvim) still surface so real migrations aren't hidden.
local config_dir = vim.fn.stdpath("config")

local orig_deprecate = vim.deprecate
vim.deprecate = function(...)
	for level = 2, 20 do
		local info = debug.getinfo(level, "S")
		if not info then
			break
		end
		if info.source:sub(1, 1) == "@" then
			local src = info.source:sub(2)
			if src:find(config_dir, 1, true) then
				return orig_deprecate(...)
			end
			return
		end
	end
	return orig_deprecate(...)
end
