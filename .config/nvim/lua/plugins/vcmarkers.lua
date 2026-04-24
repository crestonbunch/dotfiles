return {
	"algmyr/vcmarkers.nvim",
	dependencies = { "algmyr/vclib.nvim" },
	event = { "BufReadPre", "BufNewFile" },
	config = function()
		require("vcmarkers").setup({})

		local vcm = require("vcmarkers")
		local map = function(lhs, rhs, desc)
			vim.keymap.set("n", lhs, rhs, { noremap = true, silent = true, desc = desc })
		end

		map("]x", function() vcm.actions.next_marker(0, vim.v.count1) end, "Next conflict marker")
		map("[x", function() vcm.actions.prev_marker(0, vim.v.count1) end, "Previous conflict marker")
		map("<leader>ms", function() vcm.actions.select_section_verbatim(0) end, "Replace marker with section contents")
		map("<leader>mS", function() vcm.actions.select_all_plus(0) end, "Replace marker with plus parts")
		map("<leader>mf", function() vcm.fold.toggle(0) end, "Fold outside markers")
		map("<leader>mc", function() vcm.actions.cycle_marker(0) end, "Cycle marker representations")
	end,
}
