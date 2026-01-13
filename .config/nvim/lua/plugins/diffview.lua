return {
	"sindrets/diffview.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	cmd = {
		"DiffviewOpen",
		"DiffviewClose",
		"DiffviewToggleFiles",
		"DiffviewFocusFiles",
		"DiffviewRefresh",
		"DiffviewFileHistory",
	},
	keys = {
		{ "<leader>gd", "<cmd>DiffviewOpen<cr>", desc = "Open Diffview" },
		{ "<leader>gh", "<cmd>DiffviewFileHistory %<cr>", desc = "File History" },
		{ "<leader>gH", "<cmd>DiffviewFileHistory<cr>", desc = "Branch History" },
		{ "<leader>gq", "<cmd>DiffviewClose<cr>", desc = "Close Diffview" },
	},
	config = function()
		require("diffview").setup({
			enhanced_diff_hl = true,
			view = {
				default = {
					layout = "diff2_horizontal",
				},
				merge_tool = {
					layout = "diff3_horizontal",
				},
			},
		})
	end,
}
