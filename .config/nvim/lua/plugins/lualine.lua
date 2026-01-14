return {
	{
		"nvim-lualine/lualine.nvim",
		dependencies = {
			"nvim-tree/nvim-web-devicons",
			"folke/trouble.nvim",
		},
		opts = function(_, opts)
			-- Initialize opts if needed
			opts = opts or {}
			opts.sections = opts.sections or {}
			opts.sections.lualine_c = opts.sections.lualine_c or { "filename" }
			opts.sections.lualine_x = opts.sections.lualine_x or { "encoding", "fileformat", "filetype" }

			-- Set up trouble integration for LSP symbols
			local has_trouble, trouble = pcall(require, "trouble")
			if has_trouble then
				local symbols = trouble.statusline({
					mode = "lsp_document_symbols",
					groups = {},
					title = false,
					filter = { range = true },
					format = "{kind_icon}{symbol.name:Normal}",
					hl_group = "lualine_c_normal",
				})
				table.insert(opts.sections.lualine_c, {
					symbols.get,
					cond = symbols.has,
				})
			end

			-- LSP status: show active LSP clients
			table.insert(opts.sections.lualine_x, 1, "lsp_status")

			return opts
		end,
	},
}
