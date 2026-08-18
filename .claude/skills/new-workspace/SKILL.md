---
name: new-workspace
description: Move a new task into its own jj workspace under ~/.workspaces, then open a zellij tab with a Claude pane and a terminal pane that starts from a brief. Use when the user agrees to start a new workstream outside the current working copy, or asks for a new workspace, a worktree, or a parallel task.
---

# Start a task in a new workspace

A `jj` workspace gives the new task a second working copy on the same repo.
The changes in the current working copy stay untouched, and the new task gets
its own revision, its own Claude session, and its own pull request.

`new-workspace.sh` does the mechanical work: it names the workspace, runs
`jj workspace add`, writes the brief, and opens the zellij tab. You decide the
slug, the base revision, the title, and the content of the brief.

Do not start the new task in the current session.

## 1. Read the state of the repo

```bash
jj workspace root
jj st
jj log --no-graph -r 'trunk()..@' -T 'change_id.short() ++ " " ++ description.first_line() ++ "\n"'
```

If there is no jj repo, tell the user and stop.

## 2. Decide four things

- **Slug**: two to four kebab-case words for the task, such as
  `fix-login-timeout`. It names the zellij tab, and the workspace becomes
  `<repo-name>-<slug>`.
- **Base revision**: `trunk()` by default. Use `@` only when the new task needs
  the uncommitted code in the current working copy. For a current trunk, run
  `jj git fetch` first.
- **Title**: an imperative sentence for the description of the new revision.
  It follows the pull request title rules, because the PR inherits it.
- **Brief**: the context below.

Tell the user which base revision you use.

## 3. Run the script

```bash
~/.claude/skills/new-workspace/new-workspace.sh create <slug> \
  --base 'trunk()' \
  --message "<title>" \
  --brief - <<'EOF'
# <title>

## Goal

<Two to four sentences. What the user wants and why.>

## Context from the previous session

<Decisions, constraints, rejected alternatives, error messages, ticket and PR
links. Omit the section if there is none.>

## Where to start

<Files, functions, and commands that the new session needs. Omit the section
if there is none.>
EOF
```

The new Claude session starts with no history, so the brief is the only
context it gets. Write the facts that the new session cannot read from the
repo:

- Write 60 lines maximum.
- Do not copy diffs or file contents into it.
- Do not put a credential or a token in it.
- Do not repeat the workspace paths. The script adds them.

The script prints `workspace_name`, `workspace_path`, `base_revision`,
`brief`, and `tab` on stdout. jj and zellij write to stderr.

Options: `--no-tab` skips the tab, and `--brief <file>` reads a file instead
of stdin. Run the script with `--help` for the full usage.

## 4. Report

Give the user the workspace path, the base revision, and the brief path from
the output of the script. If the output has `tab=none`, zellij is absent. Give
the user the `run=` command instead.

## 5. Remove the workspace when the work merges

```bash
~/.claude/skills/new-workspace/new-workspace.sh remove <workspace_name>
```

Run it from the main repo, not from the workspace. It forgets the workspace and
deletes the two directories. Close the zellij tab first:

```bash
zellij action go-to-tab-name <slug> && zellij action close-tab
```

If jj reports a stale working copy in a workspace that you return to, run
`jj workspace update-stale` in it.
