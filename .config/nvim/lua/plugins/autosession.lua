return {
  "rmagatti/auto-session",
  lazy = false,
  priority = 1000, -- Load before other plugins

  ---enables autocomplete for opts
  ---@module "auto-session"
  ---@type AutoSession.Config
  opts = {
    suppressed_dirs = { "~/", "~/Projects", "~/Downloads", "/" },
    -- Handle directory changes from project.nvim
    cwd_change_handling = {
      restore_upcoming_session = true,
      pre_cwd_changed_hook = nil,
      post_cwd_changed_hook = function()
        require("auto-session").AutoSaveSession()
      end,
    },
    -- Auto restore session on startup
    auto_restore_enabled = true,
    auto_save_enabled = true,
    -- log_level = 'debug',
  },
}
