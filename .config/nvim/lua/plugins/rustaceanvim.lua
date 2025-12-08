return {
	{
		"mrcjkb/rustaceanvim",
		version = "^6",
		lazy = false, -- Plugin handles lazy loading internally
		ft = "rust",
		dependencies = {
			"saghen/blink.cmp",
		},
		init = function()
			-- Configure before plugin loads
			vim.g.rustaceanvim = {
				server = {
					capabilities = require("blink.cmp").get_lsp_capabilities(),
					settings = {
						["rust-analyzer"] = {
							check = {
								command = "clippy",
							},
						},
					},
				},
			}
		end,
	},
}
