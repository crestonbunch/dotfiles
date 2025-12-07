return {
  {
    "NeogitOrg/neogit",
    lazy = true,
    dependencies = {
      "nvim-lua/plenary.nvim",         -- required
      "sindrets/diffview.nvim",        -- optional - Diff integration
      "ibhagwan/fzf-lua",              -- optional
    },
    cmd = "Neogit",
    keys = {
      { "<leader>gg", "<cmd>Neogit<cr>", desc = "Show Neogit UI" },
      { "<leader>gw", "<cmd>Neogit worktree<cr>", desc = "Neogit worktree" },
      { "<leader>gc", "<cmd>Neogit commit<cr>", desc = "Neogit commit" },
    }
  }
}
