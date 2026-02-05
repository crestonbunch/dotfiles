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
				finder = {
					keys = {
						open = "<CR>",
						vsplit = "<C-v>",
						split = "<C-h>",
						tabe = "<C-t>",
						quit = "q",
					},
				},
				definition = {
					keys = {
						edit = "<CR>",
						vsplit = "<C-v>",
						split = "<C-h>",
						tabe = "<C-t>",
						quit = "q",
					},
				},
			})
		end,
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			"nvim-tree/nvim-web-devicons",
		},
	},
}
