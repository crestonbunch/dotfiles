return {
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v3.x",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"MunifTanjim/nui.nvim",
			"nvim-tree/nvim-web-devicons", -- optional, but recommended
		},
		lazy = false,
		opts = {
			filesystem = {
				follow_current_file = {
					enabled = true, -- Reveal and focus the current file when opening
					leave_dirs_open = false, -- Close other directories when revealing
				},
				commands = {
					-- Open with tab drop and close neo-tree if it's a file
					open_tab_drop_and_close = function(state)
						local node = state.tree:get_node()

						if node.type == "file" then
							-- Use tab drop: switch to existing tab or open in new tab
							vim.cmd("tab drop " .. vim.fn.fnameescape(node.path))
							-- Close neo-tree after opening the file
							require("neo-tree.command").execute({ action = "close" })
						elseif node.type == "directory" then
							-- Toggle directory open/close
							require("neo-tree.sources.filesystem.commands").toggle_node(state)
						end
					end,
				},
			},
			window = {
				mappings = {
					["<CR>"] = "open_tab_drop_and_close",
					["<S-CR>"] = "open_tab_drop",
				},
			},
		},
	},
}
