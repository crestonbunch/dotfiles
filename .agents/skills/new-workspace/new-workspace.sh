#!/usr/bin/env bash
set -euo pipefail

# Create or remove a jj workspace for one task, under ~/.workspaces.
#
# Usage:
#   new-workspace.sh create <slug> [options]
#     --base <revset>    parent for the new working copy (default: trunk())
#     --message <text>   description for the new working copy
#     --session <value>  current conversation ID or file (normally detected)
#     --no-tab           do not open a zellij tab
#   new-workspace.sh remove <workspace-name>
#
# create prints key=value lines on stdout. jj and zellij write to stderr.

workspaces_dir="$HOME/.workspaces"
tasks_dir="$workspaces_dir/.tasks"
continuation_prompt="Continue this task in the new workspace. Work only in this workspace."

die() { printf 'new-workspace: %s\n' "$1" >&2; exit 1; }

repo_root() {
  jj workspace root 2>/dev/null || die "not a jj repo (cwd: $PWD)"
}

repo_name() {
  local root store
  root="$1"
  store=$(cd "$root/.jj" && realpath "$(cat repo 2>/dev/null || echo repo)") \
    || die "cannot resolve the repo store of $root"
  basename "$(dirname "$(dirname "$store")")"
}

detect_agent() {
  local detected="${AI_AGENT:-}"
  detected=$(printf '%s' "$detected" | tr '[:upper:]' '[:lower:]')
  case "$detected" in
    pi|codex|claude|opencode) printf '%s\n' "$detected"; return ;;
    claude-code|claudecode) printf 'claude\n'; return ;;
    open-code) printf 'opencode\n'; return ;;
  esac

  if [ -n "${PI_SESSION_FILE:-}" ] || [ -n "${PI_SESSION_ID:-}" ]; then
    printf 'pi\n'
  elif [ -n "${CODEX_THREAD_ID:-}" ]; then
    printf 'codex\n'
  elif [ -n "${CLAUDE_SESSION_ID:-}${CLAUDE_CODE_SESSION_ID:-}${CLAUDECODE:-}" ]; then
    printf 'claude\n'
  elif [ -n "${OPENCODE_SESSION_ID:-}${OPENCODE:-}" ]; then
    printf 'opencode\n'
  else
    die "cannot detect the calling agent; set AI_AGENT"
  fi
}

detect_session() {
  local agent="$1" override="$2" session=""
  if [ -n "$override" ]; then
    printf '%s\n' "$override"
    return
  fi

  case "$agent" in
    pi) session="${PI_SESSION_FILE:-${PI_SESSION_ID:-}}" ;;
    codex) session="${CODEX_THREAD_ID:-}" ;;
    claude) session="${CLAUDE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}" ;;
    opencode) session="${OPENCODE_SESSION_ID:-}" ;;
  esac
  [ -n "$session" ] || die "cannot detect the current $agent conversation; pass --session"
  printf '%s\n' "$session"
}

build_launch_command() {
  local agent="$1" session="$2" dest="$3"
  case "$agent" in
    pi) launch_command=(pi --fork "$session" "$continuation_prompt") ;;
    codex) launch_command=(codex fork "$session" -C "$dest" "$continuation_prompt") ;;
    claude) launch_command=(claude --resume "$session" --fork-session "$continuation_prompt") ;;
    opencode) launch_command=(opencode --session "$session" --fork --prompt "$continuation_prompt") ;;
  esac
}

print_command() {
  local arg
  printf 'cd %q && ' "$1"
  shift
  for arg in "$@"; do printf '%q ' "$arg"; done
  printf '\n'
}

write_launcher() {
  local path="$1" dest="$2" arg
  shift 2
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\ncd %q\nexec ' "$dest"
    for arg in "$@"; do printf '%q ' "$arg"; done
    printf '\n'
  } > "$path"
  chmod +x "$path"
}

# A layout given to new-tab replaces the tab template of the session, so the
# tab gets whichever bars the layout names instead of the ones in the config.
# A tab created without a layout takes the template of the session.
open_tab() {
  local name="$1" dest="$2" launcher="$3" tab_id
  tab_id=$(zellij action new-tab --name "$name" --cwd "$dest")
  zellij action new-pane --tab-id "$tab_id" --stacked --name "" --cwd "$dest" -- "$launcher" >/dev/null
  printf '%s\n' "$tab_id"
}

cmd_create() {
  local slug="${1:-}"; shift || true
  [ -n "$slug" ] || die "usage: new-workspace.sh create <slug> [options]"
  [[ $slug =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be kebab-case: $slug"

  local base="trunk()" message="" session_override="" want_tab=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --base) base="${2:?--base needs a revset}"; shift 2 ;;
      --message) message="${2:?--message needs text}"; shift 2 ;;
      --session) session_override="${2:?--session needs an ID or path}"; shift 2 ;;
      --no-tab) want_tab=0; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done

  local agent session
  agent=$(detect_agent)
  session=$(detect_session "$agent" "$session_override")
  command -v "$agent" >/dev/null 2>&1 || die "agent command not found: $agent"

  local root name dest
  root=$(repo_root)

  local base_desc
  base_desc=$(jj log --no-graph --ignore-working-copy -r "$base" \
    -T 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ description.first_line() ++ "\n"' 2>/dev/null) \
    || die "base revision does not resolve: $base"
  [ "$(printf '%s\n' "$base_desc" | grep -c .)" = 1 ] \
    || die "base revision is not a single commit: $base"

  name="$(repo_name "$root")-$slug"
  if [ -e "$workspaces_dir/$name" ] || jj workspace list | grep -q "^$name: "; then
    name="$name-$RANDOM"
  fi
  dest="$workspaces_dir/$name"

  mkdir -p "$workspaces_dir"
  if [ -n "$message" ]; then
    jj workspace add -r "$base" -m "$message" "$dest" >&2
  else
    jj workspace add -r "$base" "$dest" >&2
  fi

  build_launch_command "$agent" "$session" "$dest"

  printf 'workspace_name=%s\n' "$name"
  printf 'workspace_path=%s\n' "$dest"
  printf 'base_revision=%s\n' "$base_desc"
  printf 'agent=%s\n' "$agent"
  printf 'source_session=%s\n' "$session"

  if [ "$want_tab" = 0 ] || [ -z "${ZELLIJ:-}" ] || ! command -v zellij >/dev/null 2>&1; then
    printf 'tab=none\n'
    printf 'run='
    print_command "$dest" "${launch_command[@]}"
    return 0
  fi

  local task_dir="$tasks_dir/$name"
  mkdir -p "$task_dir"
  local launcher="$task_dir/launch.sh"
  write_launcher "$launcher" "$dest" "${launch_command[@]}"

  local tab_id
  tab_id=$(open_tab "$slug" "$dest" "$launcher")
  printf 'tab=%s\n' "$slug"
  printf 'tab_id=%s\n' "$tab_id"
}

cmd_remove() {
  local name="${1:-}"
  [ -n "$name" ] || die "usage: new-workspace.sh remove <workspace-name>"
  case "$name" in
    */*|.|..|"") die "bad workspace name: $name" ;;
  esac

  repo_root >/dev/null
  local list
  list=$(jj workspace list)
  grep -q "^$name: " <<<"$list" || die "no such jj workspace: $name"

  jj workspace forget "$name" >&2
  rm -rf "$workspaces_dir/$name" "$tasks_dir/$name"
  rmdir "$tasks_dir" 2>/dev/null || true
  printf 'removed=%s\n' "$name"
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  remove) shift; cmd_remove "$@" ;;
  ""|-h|--help) awk 'NR>2 { if (/^#/) { sub(/^# ?/, ""); print } else if (NF) exit }' "$0" ;;
  *) die "unknown command: $1 (expected create or remove)" ;;
esac
