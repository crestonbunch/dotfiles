return {
	{
		"ibhagwan/fzf-lua",
		-- optional for icon support
		dependencies = { "nvim-tree/nvim-web-devicons" },
		-- or if using mini.icons/mini.nvim
		-- dependencies = { "nvim-mini/mini.icons" },
		config = function()
			local actions = require("fzf-lua.actions")

			-- Custom tab drop action: switch to tab if file is open, else open in new tab
			local file_tab_drop = function(selected, opts)
				actions.vimcmd_entry("tab drop", selected, opts)
			end

			require("fzf-lua").setup({
				actions = {
					files = {
						["default"] = file_tab_drop,
					},
				},
			})
		end,
	},
}
