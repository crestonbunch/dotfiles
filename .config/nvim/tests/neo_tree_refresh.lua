-- Run with: nvim --headless -u NONE -i NONE -l ~/.config/nvim/tests/neo_tree_refresh.lua
-- Recursive filesystem-event checks use macOS/Windows libuv behavior.
local config_dir = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":h:h")
local plugin_dir = vim.fn.stdpath("data") .. "/lazy/"
vim.opt.rtp:append(config_dir)
for _, name in ipairs({ "neo-tree.nvim", "plenary.nvim", "nui.nvim", "nvim-web-devicons" }) do
  vim.opt.rtp:append(plugin_dir .. name)
end

local home = vim.fn.tempname()
vim.fn.mkdir(home, "p")
home = assert(vim.uv.fs_realpath(home))
local project = home .. "/.workspaces/project"
vim.fn.mkdir(project, "p")
vim.fn.mkdir(home .. "/.local/share/nvim", "p")
vim.fn.writefile({ "*", "!.gitignore", "!tracked.txt" }, home .. "/.gitignore")
vim.fn.writefile({ "home" }, home .. "/tracked.txt")
vim.fn.writefile({ "project" }, project .. "/project.txt")
local system = vim.system
local diff_count = 0

local function settle()
  vim.wait(700, function() return false end)
end

local function await_refresh(before)
  assert(vim.wait(3000, function() return diff_count > before end), "expected a jj diff refresh")
  settle()
end

local ok, err = pcall(function()
  assert(system({ "jj", "git", "init", home }, { text = true }):wait().code == 0, "home fixture init failed")
  assert(system({ "jj", "git", "init", project }, { text = true }):wait().code == 0, "project fixture init failed")
  vim.env.HOME = home
  vim.system = function(cmd, opts, callback)
    if cmd[1] == "jj" and cmd[3] == "diff" then
      diff_count = diff_count + 1
    end
    return system(cmd, opts, callback)
  end
  local opts = dofile(config_dir .. "/lua/plugins/neo-tree.lua")[1].opts
  opts.enable_diagnostics = false
  require("neo-tree").setup(opts)
  vim.cmd.cd(home)
  vim.cmd.edit(home .. "/tracked.txt")
  local command = require("neo-tree.command")
  command.execute({ source = "jj_changed", action = "show" })
  await_refresh(0)
  local events = require("neo-tree.events")
  local manager = require("neo-tree.sources.manager")
  assert(manager.get_state("jj_changed").path == home)

  local before_noise = diff_count
  vim.fn.writefile({ "noise" }, home .. "/.workspaces/noise.txt")
  settle()
  assert(diff_count == before_noise, "external workspace churn refreshed the home jj pane")
  print("PASS: external workspace churn does not refresh home jj")

  local before_notifications = diff_count
  events.fire_event(events.VIM_BUFFER_CHANGED, { afile = home .. "/.workspaces/noise.txt" })
  events.fire_event(events.FILE_ADDED, home .. "/.workspaces/noise.txt")
  events.fire_event(events.FILE_MOVED, {
    source = home .. "/.workspaces/noise.txt", destination = home .. "/.workspaces/moved.txt",
  })
  settle()
  assert(diff_count == before_notifications, "noisy save/file-op notifications refreshed home jj")
  print("PASS: noisy save/file-op notifications do not refresh home jj")

  local before_move = diff_count
  events.fire_event(events.FILE_MOVED, {
    source = home .. "/.workspaces/noise.txt", destination = home .. "/tracked.txt",
  })
  await_refresh(before_move)
  print("PASS: moving a file out of an excluded directory refreshes home jj")

  local before_edit = diff_count
  vim.fn.writefile({ "edited home" }, home .. "/tracked.txt")
  await_refresh(before_edit)
  print("PASS: external home-file edits still refresh jj")

  vim.cmd.cd(project)
  vim.cmd.edit(project .. "/project.txt")
  local before_project = diff_count
  command.execute({ source = "jj_changed", action = "show" })
  await_refresh(before_project)
  assert(manager.get_state("jj_changed").path == project)
  local before_project_edit = diff_count
  vim.fn.writefile({ "edited project" }, project .. "/project.txt")
  await_refresh(before_project_edit)
  print("PASS: directly opened workspaces retain external-edit refreshes")

  command.execute({ source = "filesystem", action = "show", dir = project })
  assert(vim.wait(3000, function()
    local worktree = require("neo-tree.git").worktrees[project]
    return worktree and worktree.status and worktree.status[project .. "/project.txt"] ~= nil
  end), "direct workspace lost native Git status")
  print("PASS: directly opened workspaces retain native Git status")

  vim.cmd.cd(home)
  vim.cmd.edit(home .. "/tracked.txt")
  command.execute({ source = "filesystem", action = "show", dir = home })
  assert(vim.wait(3000, function()
    local state = manager.get_state("filesystem")
    return state.tree and state.tree:get_node(home) ~= nil
  end), "home filesystem tree did not load")
  local fs_events = 0
  events.subscribe({ event = events.FS_EVENT, handler = function() fs_events = fs_events + 1 end })
  settle()
  local before_excluded_event = fs_events
  assert(vim.uv.fs_utime(home .. "/.workspaces", os.time(), os.time()))
  settle()
  assert(fs_events == before_excluded_event, "native exclusion emitted a filesystem refresh event")
  print("PASS: native exclusion suppresses filesystem refresh events")

  assert(vim.uv.fs_mkdir(home .. "/ordinary", 448))
  assert(vim.wait(3000, function() return fs_events > before_excluded_event end), "ordinary filesystem event was suppressed")
  print("PASS: ordinary filesystem changes still emit refresh events")
end)

vim.system = system
if package.loaded["neo-tree.sources.filesystem.lib.fs_watch"] then
  require("neo-tree.sources.filesystem.lib.fs_watch").stop_watching()
end
vim.fn.delete(home, "rf")
if not ok then error(err) end
vim.cmd("qa!")
