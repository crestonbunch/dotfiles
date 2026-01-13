-- Neo-tree: Reveal current file in floating window
-- Note: fzf-lua keymaps are defined in plugins/fzf.lua for lazy loading
vim.keymap.set("n", "<leader>..", ":Neotree float reveal<CR>", { desc = "Open all files" })
vim.keymap.set("n", "<leader>.b", ":Neotree source=buffers float reveal<CR>", { desc = "Open buffers" })
vim.keymap.set("n", "<leader>.g", ":Neotree source=git_status float reveal<CR>", { desc = "Open gitstatus" })

-- LSP
vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc")
vim.keymap.set("n", "<C-.>", "<cmd>Lspsaga code_action<CR>", { desc = "Code actions" })
vim.keymap.set("n", "<C-,>", "<cmd>Lspsaga show_cursor_diagnostics<CR>", { desc = "Show diagnostics" })

-- Rust
vim.keymap.set("n", "<leader>rr", "<cmd>RustLsp run<CR>", { desc = "Rust run" })
vim.keymap.set("n", "<leader>rl", "<cmd>RustLsp runnables<CR>", { desc = "Rust runnables" })

-- Sort
vim.keymap.set("v", "<leader>sa", ":sort<CR>", { desc = "Sort selection" })

-- Clear search highlighting
vim.keymap.set("n", "<Esc>", "<cmd>nohlsearch<CR><Esc>", { desc = "Clear search highlighting" })
vim.keymap.set("n", "<leader>h", "<cmd>nohlsearch<CR>", { desc = "Clear search highlighting" })
