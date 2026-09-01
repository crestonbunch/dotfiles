#!/usr/bin/env bash
set -euo pipefail

# Create or remove a jj workspace for one task, under ~/.workspaces.
#
# Usage:
#   new-workspace.sh create <slug> [options]
#     --base <revset>    parent for the new working copy (default: trunk())
#     --message <text>   description for the new working copy
#     --brief <file|->   task brief for the new Claude session (- reads stdin)
#     --no-tab           do not open a zellij tab
#   new-workspace.sh remove <workspace-name>
#
# create prints key=value lines on stdout. jj and zellij write to stderr.
#
# The workspace name is "<repo-name>-<slug>", with a random suffix if that name
# is in use. Inside zellij, create opens a tab with two stacked panes:
# Claude on the brief, and a shell. Both panes start in the workspace.

workspaces_dir="$HOME/.workspaces"
tasks_dir="$workspaces_dir/.tasks"

die() { printf 'new-workspace: %s\n' "$1" >&2; exit 1; }

repo_root() {
  jj workspace root 2>/dev/null || die "not a jj repo (cwd: $PWD)"
}

# In a secondary workspace, .jj/repo is a file that points at the store of the
# main workspace. Resolve it, so a workspace created from inside a workspace is
# named after the repo and not after its parent workspace.
repo_name() {
  local root store
  root="$1"
  store=$(cd "$root/.jj" && realpath "$(cat repo 2>/dev/null || echo repo)") \
    || die "cannot resolve the repo store of $root"
  basename "$(dirname "$(dirname "$store")")"
}

cmd_create() {
  local slug="${1:-}"; shift || true
  [ -n "$slug" ] || die "usage: new-workspace.sh create <slug> [options]"
  [[ $slug =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be kebab-case: $slug"

  local base="trunk()" message="" brief_src="" want_tab=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --base) base="${2:?--base needs a revset}"; shift 2 ;;
      --message) message="${2:?--message needs text}"; shift 2 ;;
      --brief) brief_src="${2:?--brief needs a file or -}"; shift 2 ;;
      --no-tab) want_tab=0; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done

  local root name dest
  root=$(repo_root)

  # Read the brief before jj runs, so a missing file fails before the workspace
  # exists.
  local brief_body=""
  if [ -n "$brief_src" ]; then
    if [ "$brief_src" = "-" ]; then
      brief_body=$(cat)
    else
      [ -f "$brief_src" ] || die "brief not found: $brief_src"
      brief_body=$(cat "$brief_src")
    fi
    [ -n "$brief_body" ] || die "brief is empty"
  fi

  local base_desc
  base_desc=$(jj log --no-graph --ignore-working-copy -r "$base" \
    -T 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ description.first_line() ++ "\n"' 2>/dev/null) \
    || die "base revision does not resolve: $base"
  [ "$(printf '%s\n' "$base_desc" | grep -c .)" = 1 ] \
    || die "base revision is not a single commit: $base"

  name="$(repo_name "$root")-$slug"
  # The name can be taken by a directory, or by a workspace whose directory was
  # removed without `jj workspace forget`.
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

  local task_dir="$tasks_dir/$name" brief=""
  if [ -n "$brief_body" ]; then
    mkdir -p "$task_dir"
    brief="$task_dir/brief.md"
    printf '%s\n' "$brief_body" > "$brief"
  fi

  printf 'workspace_name=%s\n' "$name"
  printf 'workspace_path=%s\n' "$dest"
  printf 'base_revision=%s\n' "$base_desc"
  [ -n "$brief" ] && printf 'brief=%s\n' "$brief"

  local prompt=""
  [ -n "$brief" ] && prompt="Read $brief and start the task in it."

  if [ "$want_tab" = 0 ] || [ -z "${ZELLIJ:-}" ] || ! command -v zellij >/dev/null 2>&1; then
    printf 'tab=none\n'
    if [ -n "$prompt" ]; then
      printf 'run=cd %s && claude "%s"\n' "$dest" "$prompt"
    else
      printf 'run=cd %s && claude\n' "$dest"
    fi
    return 0
  fi

  mkdir -p "$task_dir"
  local layout="$task_dir/tab.kdl"
  {
    printf 'layout {\n'
    printf '    default_tab_template {\n'
    printf '        pane size=1 borderless=true {\n'
    printf '            plugin location="zellij:tab-bar"\n'
    printf '        }\n'
    printf '        children\n'
    printf '        pane size=1 borderless=true {\n'
    printf '            plugin location="zellij:status-bar"\n'
    printf '        }\n'
    printf '    }\n'
    printf '    tab {\n'
    printf '        pane stacked=true {\n'
    printf '            pane focus=true expanded=true command="claude" {\n'
    [ -n "$prompt" ] && printf '                args "%s"\n' "$prompt"
    printf '            }\n'
    printf '            pane\n'
    printf '        }\n'
    printf '    }\n'
    printf '}\n'
  } > "$layout"

  local tab_id
  tab_id=$(zellij action new-tab --layout "$layout" --cwd "$dest" --name "$slug")
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
  # A here-string, not a pipe: grep -q exits at the first match, and under
  # pipefail a SIGPIPE from jj would look like "workspace not found".
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
