-- Fuzzy file finder
vim.keymap.set("n", "<C-p>", '<cmd>lua require("fzf-lua").files()<CR>', { desc = "Find files" })
vim.keymap.set("n", "<D-p>", '<cmd>lua require("fzf-lua").files()<CR>', { desc = "Find files" })

-- Optional: additional useful fzf-lua keymaps
vim.keymap.set("n", "<leader>fg", '<cmd>lua require("fzf-lua").live_grep()<CR>', { desc = "Live grep" })
vim.keymap.set("n", "<leader>fb", '<cmd>lua require("fzf-lua").buffers()<CR>', { desc = "Find buffers" })
vim.keymap.set("n", "<leader>fh", '<cmd>lua require("fzf-lua").help_tags()<CR>', { desc = "Help tags" })

-- Neo-tree: Reveal current file in floating window
vim.keymap.set("n", "<leader>..", ":Neotree float reveal<CR>", { desc = "Open all files" })
vim.keymap.set("n", "<leader>.b", ":Neotree source=buffers float reveal<CR>", { desc = "Open buffers" })
vim.keymap.set("n", "<leader>.g", ":Neotree source=git_status float reveal<CR>", { desc = "Open gitstatus" })

-- LSP
vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc")

-- Sort
vim.keymap.set("v", "<leader>sa", ":sort<CR>", { desc = "Sort selection" })
