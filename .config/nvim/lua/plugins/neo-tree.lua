return {
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v3.x",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"MunifTanjim/nui.nvim",
			"nvim-tree/nvim-web-devicons", -- optional, but recommended
		},
		lazy = false, -- neo-tree will lazy load itself 
		cmd = "Neotree",
		keys = {
			{ "<leader>e", "<cmd>Neotree toggle<cr>", desc = "Toggle file tree" },
			{ "<leader>E", "<cmd>Neotree reveal<cr>", desc = "Reveal file in tree" },
		},
		opts = {
			filesystem = {
				follow_current_file = {
					enabled = true, -- Reveal and focus the current file when opening
					leave_dirs_open = false, -- Close other directories when revealing
				},
			},
		},
	},
}
