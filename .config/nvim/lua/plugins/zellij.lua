return {
  "fresh2dev/zellij.vim",
  lazy = false,
  config = function()
    vim.g.zellij_navigator_no_default_mappings = 1

    -- Set up keymaps for seamless navigation between nvim splits and zellij panes
    vim.keymap.set("n", "<C-h>", "<cmd>ZellijNavigateLeft<cr>", { silent = true, desc = "Navigate left" })
    vim.keymap.set("n", "<C-j>", "<cmd>ZellijNavigateDown<cr>", { silent = true, desc = "Navigate down" })
    vim.keymap.set("n", "<C-k>", "<cmd>ZellijNavigateUp<cr>", { silent = true, desc = "Navigate up" })
    vim.keymap.set("n", "<C-l>", "<cmd>ZellijNavigateRight<cr>", { silent = true, desc = "Navigate right" })
  end,
}
