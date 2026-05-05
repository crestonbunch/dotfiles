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

-- Git
-- Resolve a jj revset to a commit hash. Uses commit_id rather than a bookmark
-- name so it works even when the matched commit has only a remote bookmark
-- (e.g. master@origin with no local master).
local function jj_revset_commit(revset)
	local cmd = string.format([[jj log -r '%s' --no-graph -T 'commit_id ++ "\n"' 2>/dev/null]], revset)
	local out = vim.fn.system(cmd)
	if vim.v.shell_error ~= 0 then
		return nil
	end
	return vim.trim(out):match("^%x+")
end

-- Symmetric diff (...) against nearest ancestor with any bookmark — the parent
-- in a stacked workflow, falling through to trunk since trunk normally has a
-- bookmark too.
vim.keymap.set("n", "<leader>gb", function()
	local hash = jj_revset_commit("heads(::@- & (bookmarks() | remote_bookmarks()))")
	if not hash then
		vim.notify("No ancestor bookmark found", vim.log.levels.WARN)
		return
	end
	vim.cmd("DiffviewOpen " .. hash .. "...HEAD --imply-local")
end, { desc = "Diffview vs ancestor branch" })

-- Symmetric diff (...) against trunk.
vim.keymap.set("n", "<leader>gt", function()
	local hash = jj_revset_commit("trunk()")
	if not hash then
		vim.notify("No trunk found", vim.log.levels.WARN)
		return
	end
	vim.cmd("DiffviewOpen " .. hash .. "...HEAD --imply-local")
end, { desc = "Diffview vs trunk" })
