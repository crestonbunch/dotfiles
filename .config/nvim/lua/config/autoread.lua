-- Reload buffers whose file changed on disk, driven by OS filesystem events
-- (FSEvents on macOS, inotify on Linux) rather than a poll. Idle cost is zero:
-- the kernel only calls back when a watched directory actually changes.
--
-- We watch each buffer's parent *directory*, never the file itself. jj/git/
-- editors replace files by writing a temp file and renaming it over the target,
-- which unlinks the original inode and would kill a file-level watch; the
-- directory inode is stable and sees the rename.

vim.opt.autoread = true

local uv = vim.uv
local watchers = {} -- dir -> uv_fs_event handle (one per unique dir, kept for the session)

local function checktime_buf(buf)
  if
    vim.api.nvim_buf_is_loaded(buf)
    and vim.bo[buf].buftype == ""
    and not vim.bo[buf].modified
    and vim.api.nvim_buf_get_name(buf) ~= ""
  then
    pcall(vim.cmd, buf .. "checktime")
  end
end

local function reload_clean_buffers()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    checktime_buf(buf)
  end
end

-- A single write emits a burst of events (temp create, rename, attr change);
-- coalesce them into one reload. The timer only runs in response to real events.
local debounce = uv.new_timer()
local function schedule_reload()
  debounce:stop()
  debounce:start(50, 0, vim.schedule_wrap(reload_clean_buffers))
end

local function watch_dir(dir)
  if not dir or dir == "" or watchers[dir] then
    return
  end
  local handle = uv.new_fs_event()
  if not handle then
    return
  end
  local on_event = function(err)
    if not err then
      schedule_reload()
    end
  end
  if pcall(handle.start, handle, dir, {}, on_event) then
    watchers[dir] = handle
  else
    pcall(handle.close, handle)
  end
end

local group = vim.api.nvim_create_augroup("event_autoread", { clear = true })

vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  group = group,
  callback = function(args)
    local name = vim.api.nvim_buf_get_name(args.buf)
    if name ~= "" then
      watch_dir(vim.fs.dirname(name))
    end
  end,
})

-- Fallbacks for filesystems where fs_event is unsupported (some network mounts)
-- and for changes that landed before a watcher was armed. Refocusing the app
-- sweeps every buffer; entering one only re-checks that buffer, keeping the very
-- hot BufEnter off an all-buffers scan.
vim.api.nvim_create_autocmd("FocusGained", {
  group = group,
  callback = reload_clean_buffers,
})
vim.api.nvim_create_autocmd("BufEnter", {
  group = group,
  callback = function(args)
    checktime_buf(args.buf)
  end,
})
