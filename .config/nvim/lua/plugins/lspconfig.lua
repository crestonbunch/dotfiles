return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"saghen/blink.cmp",
		},
		config = function()
			local capabilities = require("blink.cmp").get_lsp_capabilities()

			-- Common LSP keybindings
			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("UserLspConfig", {}),
				callback = function(ev)
					local opts = { buffer = ev.buf, silent = true }

					-- Key mappings
					vim.keymap.set("n", "gd", "<cmd>Lspsaga peek_definition<cr>", opts)
					vim.keymap.set("n", "gr", "<cmd>Lspsaga finder<cr>", opts)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
					vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)
					vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, opts)
				end,
			})

			-- Terraform
			vim.lsp.config("terraformls", { capabilities = capabilities })
			vim.lsp.enable("terraformls")

			-- TypeScript/JavaScript
			vim.lsp.config("ts_ls", { capabilities = capabilities })
			vim.lsp.enable("ts_ls")

			-- Python (ty)
			vim.lsp.config("ty", {
				capabilities = capabilities,
				settings = {
					ty = {},
				},
			})
			vim.lsp.enable("ty")

			-- Java
			vim.lsp.config("jdtls", {
				capabilities = capabilities,
			})
			vim.lsp.enable("jdtls")
		end,
	},
}
