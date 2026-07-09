-- A Neo-tree source that renders a fully-expanded tree of just the files a jj
-- revision touches. It shells out to jj rather than git so it also works in
-- non-colocated repos and secondary workspaces, where `git status` sees nothing.

local renderer = require("neo-tree.ui.renderer")
local file_items = require("neo-tree.sources.common.file-items")
local manager = require("neo-tree.sources.manager")
local common_components = require("neo-tree.sources.common.components")
local common_commands = require("neo-tree.sources.common.commands")
local events = require("neo-tree.events")
local highlights = require("neo-tree.ui.highlights")
local log = require("neo-tree.log")

local M = {
  name = "jj_changed",
  display_name = " 󰊢 jj @ ",
}

-- The revset whose diff we render. Shared across the source's single tab-local
-- state; open() sets it before focusing so refresh (r) reuses it.
local revset = "@"

local STATUS_MARK = {
  M = { "M", highlights.GIT_MODIFIED },
  A = { "A", highlights.GIT_ADDED },
  D = { "D", highlights.GIT_DELETED },
  R = { "R", highlights.GIT_RENAMED },
  C = { "C", highlights.GIT_ADDED },
}

local function run(cmd, cwd)
  local res = vim.system(cmd, { cwd = cwd, text = true }):wait()
  if res.code ~= 0 then
    return nil, vim.trim(res.stderr or "")
  end
  return res.stdout or ""
end

local function workspace_root()
  local dir = vim.fn.expand("%:p:h")
  if dir == "" or vim.fn.isdirectory(dir) == 0 then
    dir = vim.fn.getcwd()
  end
  local out = run({ "jj", "workspace", "root" }, dir)
  if not out then
    return nil
  end
  out = vim.trim(out)
  return out ~= "" and out or nil
end

-- jj --summary renders renames/copies in git's compact form, collapsing the
-- unchanged pre/suffix around a `{old => new}` segment. We only want the
-- resulting path (the file that exists after the change), so expand `new`.
local function resulting_path(rest)
  local pre, _, to, post = rest:match("^(.-){(.-) => (.-)}(.*)$")
  if pre then
    return (pre .. to .. post):gsub("//", "/")
  end
  return rest
end

local function changed_files(root)
  local out, err = run({ "jj", "--no-pager", "diff", "-r", revset, "--summary" }, root)
  if not out then
    return nil, err
  end
  local changes = {}
  for line in out:gmatch("[^\n]+") do
    local code, rest = line:match("^(%a)%s+(.+)$")
    if code and rest then
      changes[#changes + 1] = { path = root .. "/" .. resulting_path(rest), code = code }
    end
  end
  return changes
end

local fs_watcher
local refresh_timer = vim.uv.new_timer()

local function window_open()
  local state = manager.get_state(M.name)
  return state ~= nil and renderer.window_exists(state)
end

local function stop_watch()
  if fs_watcher then
    pcall(fs_watcher.stop, fs_watcher)
    pcall(fs_watcher.close, fs_watcher)
    fs_watcher = nil
  end
end

-- jj snapshots the working copy on every read, including the `jj diff` our own
-- refresh runs, and that snapshot writes under .jj/. Refreshing on those events
-- would loop forever, so ignore VCS-internal paths (and nil names, which we
-- can't classify — the save/focus subscriptions still cover those).
local function vcs_internal(name)
  if not name then
    return true
  end
  local p = "/" .. name .. "/"
  return p:find("/.jj/", 1, true) ~= nil or p:find("/.git/", 1, true) ~= nil
end

-- Coalesce a burst (a save, or jj rewriting many files) into one re-diff. The
-- event subscriptions in M.setup share this timer, so an in-nvim save the
-- watcher and VIM_BUFFER_CHANGED both see still refreshes exactly once. Drops
-- the watcher once its pane is gone.
local function schedule_refresh()
  refresh_timer:stop()
  refresh_timer:start(
    200,
    0,
    vim.schedule_wrap(function()
      if window_open() then
        manager.refresh(M.name)
      else
        stop_watch()
      end
    end)
  )
end

-- Watch the workspace root so external edits and jj operations (from a terminal,
-- another editor) refresh an open pane, not just in-nvim saves. Recursive is
-- macOS/Windows-only in libuv; on Linux it degrades to the top level, with the
-- event subscriptions in M.setup still covering the rest.
local function start_watch(root)
  if fs_watcher or not root then
    return
  end
  local w = vim.uv.new_fs_event()
  if not w then
    return
  end
  local on_event = function(err, name)
    if not err and not vcs_internal(name) then
      schedule_refresh()
    end
  end
  if pcall(w.start, w, root, { recursive = true }, on_event) then
    fs_watcher = w
  else
    pcall(w.close, w)
  end
end

M.navigate = function(state, path, path_to_reveal, callback, async)
  if state.loading then
    return
  end
  state.loading = true

  local root = workspace_root()
  if not root then
    state.loading = false
    vim.schedule(function()
      vim.notify("[neo-tree] not inside a jj workspace", vim.log.levels.WARN)
    end)
    if type(callback) == "function" then
      vim.schedule(callback)
    end
    return
  end

  state.path = root
  state.jj_revset = revset
  start_watch(root)
  if path_to_reveal then
    renderer.position.set(state, path_to_reveal)
  end

  local changes, err = changed_files(root)
  if err and #err > 0 then
    log.error("jj_changed: " .. err)
  end

  local context = file_items.create_context()
  context.state = state
  local root_node = file_items.create_item(context, root, "directory")
  root_node.name = vim.fn.fnamemodify(root_node.path, ":~")
  root_node.loaded = true
  context.folders[root_node.path] = root_node

  state.default_expanded_nodes = {}
  for _, change in ipairs(changes or {}) do
    local ok, item = pcall(file_items.create_item, context, change.path, "file")
    if ok then
      item.extra = { jj_status = change.code }
    else
      log.error("jj_changed: could not add " .. change.path .. ": " .. tostring(item))
    end
  end

  for id in pairs(context.folders) do
    table.insert(state.default_expanded_nodes, id)
  end
  file_items.advanced_sort(root_node.children, state)
  renderer.show_nodes({ root_node }, state)
  state.loading = false

  if type(callback) == "function" then
    vim.schedule(callback)
  end
end

local components = vim.tbl_deep_extend("force", common_components, {})

components.name = function(config, node, state)
  local highlight = config.highlight or highlights.FILE_NAME_OPENED
  local name = node.name
  if node.type == "directory" then
    if node:get_depth() == 1 then
      highlight = highlights.ROOT_NAME
      local suffix = node:has_children() and "" or " (no changes)"
      name = "jj " .. (state.jj_revset or "@") .. suffix .. "  " .. name
    else
      highlight = highlights.DIRECTORY_NAME
    end
  end
  return { text = name, highlight = highlight }
end

components.git_status = function(_, node, _)
  local mark = node.extra and STATUS_MARK[node.extra.jj_status or ""]
  if not mark then
    return {}
  end
  return { text = mark[1] .. " ", highlight = mark[2] }
end

M.components = components

local commands = {}
common_commands._add_common_commands(commands)
commands.refresh = function()
  manager.refresh(M.name)
end
M.commands = commands

---@param rev string? Revset to diff; defaults to the working-copy revision `@`.
M.open = function(rev)
  revset = rev or "@"
  local state = manager.get_state(M.name)
  if state then
    state.jj_revset = revset
  end
  require("neo-tree.command").execute({
    source = M.name,
    action = "focus",
    position = "left",
    toggle = true,
  })
end

-- Re-diff whenever the working copy changes: on save (VIM_BUFFER_CHANGED) and
-- after neo-tree's own file ops. Routed through schedule_refresh so it shares
-- the watcher's debounce and no-ops when the pane is closed. Neo-tree clears all
-- subscriptions before re-running source setup, so this can't accumulate
-- duplicate handlers on reload.
M.setup = function()
  for _, event in ipairs({
    events.VIM_BUFFER_CHANGED,
    events.FILE_ADDED,
    events.FILE_DELETED,
    events.FILE_MOVED,
    events.FILE_RENAMED,
  }) do
    events.subscribe({ event = event, id = "jj_changed." .. event, handler = schedule_refresh })
  end
end

return M
