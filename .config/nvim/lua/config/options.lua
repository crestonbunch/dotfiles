-- Line numbers
vim.opt.number = true         -- Show line numbers
vim.opt.relativenumber = true -- Show relative line numbers

-- Tab and indentation settings
vim.opt.expandtab = true      -- Use spaces instead of tabs
vim.opt.tabstop = 2           -- Number of spaces a tab counts for
vim.opt.shiftwidth = 2        -- Number of spaces for each indent
vim.opt.softtabstop = 2       -- Number of spaces inserted when pressing tab
vim.opt.smartindent = true    -- Smart autoindenting for new lines
vim.opt.copyindent = true     -- Copy existing indentation structure

-- Search
vim.opt.ignorecase = true     -- Ignore case in search
vim.opt.smartcase = true      -- Unless uppercase is used

-- UI
vim.opt.termguicolors = true  -- True color support
vim.opt.signcolumn = "yes"    -- Always show sign column
vim.opt.cursorline = true     -- Highlight current line
vim.opt.wrap = false          -- Disable line wrapping
vim.opt.scrolloff = 16         -- Minimum lines to keep above and below cursor
vim.opt.sidescrolloff = 16    -- Minimum columns to keep left and right of cursor

-- syntax highlighting
vim.opt.syntax = "enable"

-- Auto-reload files when changed outside of Neovim
vim.opt.autoread = true

-- Check for file changes more frequently
vim.api.nvim_create_autocmd({ "FocusGained", "BufEnter", "CursorHold", "CursorHoldI" }, {
  pattern = "*",
  callback = function()
    if vim.fn.mode() ~= "c" then
      vim.cmd("checktime")
    end
  end,
})
