return {
  "nicolasgb/jj.nvim",
  version = "*",
  dependencies = { "dlyongemallo/diffview-plus.nvim" },
  keys = {
    { "<leader>jl", "<cmd>J log<cr>", desc = "Jujutsu log" },
  },
  config = function()
    require("jj").setup({ diff = { backend = "diffview-plus" } })
    local diff = require("jj.diff")
    diff.register_backend("diffview-plus", {
      diff_current = function(opts)
        diff.diff_current(vim.tbl_extend("force", opts, { backend = "diffview" }))
      end,
      show_revision = function(opts)
        diff.show_revision(vim.tbl_extend("force", opts, { backend = "diffview" }))
      end,
      diff_revisions = function(opts)
        diff.diff_revisions(vim.tbl_extend("force", opts, { backend = "diffview" }))
      end,
      diff_history_revisions = function(opts)
        local utils = require("jj.utils")
        local left = utils.get_commit_id(opts.left)
        if not left then
          return
        end
        local right = utils.get_commit_id(opts.right)
        if not right then
          return
        end
        -- jj.nvim emits Git's --range; the jj adapter needs --revisions.
        vim.cmd("DiffviewFileHistory --revisions=" .. right .. ".." .. left)
      end,
    })
  end,
}
