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
			sources = { "filesystem", "buffers", "git_status", "neotree_sources.jj_changed" },
			filesystem = {
				follow_current_file = {
					enabled = true, -- Reveal and focus the current file when opening
					leave_dirs_open = false, -- Close other directories when revealing
				},
				filtered_items = {
					-- $HOME is mostly dotfiles; hiding them leaves the tree empty.
					hide_dotfiles = false,
				},
			},
			window = {
				mappings = {
					["<CR>"] = "open",
					["<C-t>"] = "open_tabnew",
					["<C-v>"] = "open_vsplit",
					["<C-h>"] = "open_split",
					-- Preview in the main window without leaving the tree; j/k
					-- update it live, <Esc> exits. Peek a file without losing
					-- focus in the tree.
					["P"] = { "toggle_preview", config = { use_float = false } },
				},
			},
			git_status = {
				window = {
					-- No git actions from the tree: gg/gc/gp/etc. mutate the repo.
					-- Unmapping gg restores its native "go to top" motion.
					mappings = {
						["A"] = "none",
						["gu"] = "none",
						["gU"] = "none",
						["ga"] = "none",
						["gt"] = "none",
						["gr"] = "none",
						["gc"] = "none",
						["gp"] = "none",
						["gg"] = "none",
					},
				},
			},
		},
	},
}
