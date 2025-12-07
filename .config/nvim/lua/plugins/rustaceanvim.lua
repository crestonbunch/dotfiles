return {
	{
		"mrcjkb/rustaceanvim",
		version = "^6",
		lazy = false, -- Plugin handles lazy loading internally
		ft = "rust",
		init = function()
			-- Configure before plugin loads
			vim.g.rustaceanvim = {
				server = {
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
