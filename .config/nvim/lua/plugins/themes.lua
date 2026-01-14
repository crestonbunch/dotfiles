return {
	{
		"sainnhe/everforest",
		enabled = false,
		lazy = false,
		priority = 1000,
		config = function()
			-- Optionally configure and load the colorscheme
			-- directly inside the plugin declaration.
			vim.g.everforest_enable_italic = true
			vim.g.everforest_background = "hard"
			vim.cmd.colorscheme("everforest")
		end,
	},
	{
		"catppuccin/nvim",
		enabled = true,
		lazy = false,
		priority = 1000,
		config = function()
			require("catppuccin").setup({
				background = {
					light = "latte",
					dark = "frappe",
				},
			})
			vim.cmd.colorscheme("catppuccin")
		end,
	},
}
