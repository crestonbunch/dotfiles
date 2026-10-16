return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		init = function()
			vim.filetype.add({ extension = { glu = "gluon", rn = "rune" } })
		end,
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

			-- Rune (cargo install rune-cli --locked)
			vim.lsp.config("rune_languageserver", {
				cmd = { "rune", "language-server" },
				capabilities = capabilities,
			})
			vim.lsp.enable("rune_languageserver")

			-- Gluon (cargo install gluon_language-server --locked)
			vim.lsp.config("gluon_ls", {
				cmd = { "gluon_language-server" },
				filetypes = { "gluon" },
				root_markers = { ".git" },
				capabilities = capabilities,
			})
			vim.lsp.enable("gluon_ls")

			-- Current Roc compiler, not the older standalone roc_language_server.
			vim.lsp.config("roc_ls", {
				cmd = { "roc", "experimental-lsp" },
				capabilities = capabilities,
				-- Semantic checking can execute compile-time code and download packages.
				init_options = { trustedWorkspace = false },
			})
			vim.lsp.enable("roc_ls")

			-- Java
			vim.lsp.config("jdtls", {
				capabilities = capabilities,
			})
			vim.lsp.enable("jdtls")
		end,
	},
}
