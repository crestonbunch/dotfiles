return {
	{
		"nvimdev/lspsaga.nvim",
		event = "LspAttach",
		keys = {
			{ "<leader>gf", "<cmd>Lspsaga finder<cr>", desc = "LSP Finder" },
		},
		config = function()
			require("lspsaga").setup({
				lightbulb = {
					enable = true,
					sign = true,
					virtual_text = false,
				},
			})
		end,
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			"nvim-tree/nvim-web-devicons",
		},
	},
}
