return {
  "fresh2dev/zellij.vim",
  lazy = false,
  init = function()
    vim.g.zellij_navigator_no_default_mappings = 1
  end,
  config = function()
    local function nav(direction, wincmd)
      return function()
        if vim.env.ZELLIJ then
          vim.cmd("ZellijNavigate" .. direction)
        else
          vim.cmd("wincmd " .. wincmd)
        end
      end
    end

    vim.keymap.set("n", "<C-h>", nav("Left", "h"), { silent = true, desc = "Navigate left" })
    vim.keymap.set("n", "<C-j>", nav("Down", "j"), { silent = true, desc = "Navigate down" })
    vim.keymap.set("n", "<C-k>", nav("Up", "k"), { silent = true, desc = "Navigate up" })
    vim.keymap.set("n", "<C-l>", nav("Right", "l"), { silent = true, desc = "Navigate right" })

    -- Zellij's running_command tracks the pty's immediate child, not the deepest
    -- foreground process — so autolock can't see nvim when it's launched through
    -- wrappers (jj merge tool, diffview, fzf, etc.). Force Locked mode while nvim
    -- is focused, and disable autolock so it doesn't fight us. Toggle on focus so
    -- a pane switch (or tab-away) leaves zellij usable.
    if vim.env.ZELLIJ then
      local function lock()
        vim.fn.system({ "zellij", "pipe", "--plugin", "autolock", "--", "disable" })
        vim.fn.system({ "zellij", "action", "switch-mode", "locked" })
      end
      local function unlock()
        vim.fn.system({ "zellij", "action", "switch-mode", "normal" })
        vim.fn.system({ "zellij", "pipe", "--plugin", "autolock", "--", "enable" })
      end

      lock()
      vim.api.nvim_create_autocmd("FocusGained", { callback = lock })
      vim.api.nvim_create_autocmd("FocusLost", { callback = unlock })
      vim.api.nvim_create_autocmd("VimLeavePre", { callback = unlock })
    end
  end,
}
