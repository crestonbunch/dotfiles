return {
  {
    "ahmedkhalf/project.nvim",
    config = function()
      require("project_nvim").setup({
        -- Detection methods to find project root
        detection_methods = { "lsp", "pattern" },

        -- Patterns to detect project root
        patterns = { ".git", "_darcs", ".hg", ".bzr", ".svn", "Makefile", "package.json" },

        -- Don't calculate root dir on specific directories
        exclude_dirs = {},

        -- Show hidden files in telescope
        show_hidden = false,

        -- When set to false, you will get a message when project.nvim changes your directory
        silent_chdir = true,

        -- What scope to change directory
        scope_chdir = "global",
      })
    end,
  },
}
