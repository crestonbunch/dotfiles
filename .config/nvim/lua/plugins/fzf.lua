return {
	{
		"ibhagwan/fzf-lua",
		-- optional for icon support
		dependencies = { "nvim-tree/nvim-web-devicons" },
		-- or if using mini.icons/mini.nvim
		-- dependencies = { "nvim-mini/mini.icons" },
		lazy = true,
		cmd = "FzfLua",
		keys = {
			{ "<C-p>", "<cmd>FzfLua files<cr>", desc = "Find files" },
			{ "<D-p>", "<cmd>FzfLua files<cr>", desc = "Find files" },
			{ "<leader>fg", "<cmd>FzfLua live_grep<cr>", desc = "Live grep" },
			{ "<leader>fb", "<cmd>FzfLua buffers<cr>", desc = "Find buffers" },
			{ "<leader>fh", "<cmd>FzfLua help_tags<cr>", desc = "Help tags" },
		},
	},
}
