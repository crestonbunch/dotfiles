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
		enabled = false,
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
	{
		"loctvl842/monokai-pro.nvim",
		enabled = false,
		lazy = false,
		priority = 1000,
		config = function()
			require("monokai-pro").setup({
				day_night = {
					enable = true,
					day_filter = "light",
					night_filter = "spectrum",
				},
			})
			vim.cmd.colorscheme("monokai-pro")
		end,
	},
	{
		"maxmx03/solarized.nvim",
		enabled = true,
		lazy = false,
		priority = 1000,
		---@type solarized.config
		opts = {},
		config = function(_, opts)
			vim.o.termguicolors = true
			require("solarized").setup(opts)
			vim.cmd.colorscheme("solarized")
		end,
	},
}
