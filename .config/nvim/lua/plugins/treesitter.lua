return {
	"nvim-treesitter/nvim-treesitter",
	event = { "BufReadPost", "BufNewFile" },
	branch = "main",
	build = ":TSUpdate",
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
