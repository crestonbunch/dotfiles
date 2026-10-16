local stats = vim.uv.fs_stat(vim.api.nvim_buf_get_name(0))
if not stats or stats.size <= 100 * 1024 then
	vim.treesitter.start()
end
