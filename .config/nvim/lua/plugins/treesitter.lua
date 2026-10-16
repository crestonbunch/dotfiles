return {
	"nvim-treesitter/nvim-treesitter",
	lazy = false,
	branch = "main",
	build = ":TSUpdate",
	dependencies = {
		{
			url = "https://somegit.dev/vikingowl/tree-sitter-rune.git",
			name = "tree-sitter-rune",
			init = function(plugin)
				vim.api.nvim_create_autocmd("User", {
					group = vim.api.nvim_create_augroup("RuneTreesitter", { clear = true }),
					pattern = "TSUpdate",
					callback = function()
						-- Use the checkout because the installer assumes GitHub-style archives.
						require("nvim-treesitter.parsers").rune = {
							install_info = { path = plugin.dir, queries = "queries" },
						}
					end,
				})
			end,
		},
	},
	opts = {
		ensure_installed = {
			"bash",
			"clojure",
			"csv",
			"diff",
			"elm",
			"git_rebase",
			"gitcommit",
			"gitignore",
			"go",
			"groovy",
			"haskell",
			"helm",
			"http",
			"hurl",
			"java",
			"javascript",
			"jq",
			"kotlin",
			"latex",
			"lua",
			"markdown",
			"markdown_inline",
			"proto",
			"python",
			"rust",
			"svelte",
			"textproto",
			"toml",
			"tsv",
			"tsx",
			"typescript",
			"vim",
			"vimdoc",
			"yaml",
		},
		highlight = {
			enable = true,
			disable = function(lang, buf)
				local max_filesize = 100 * 1024 -- 100 KB
				local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(buf))
				if ok and stats and stats.size > max_filesize then
					return true
				end
			end,
		},
		indent = {
			enable = true,
		},
	},
}
