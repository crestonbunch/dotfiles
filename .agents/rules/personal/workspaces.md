---
description: jj workspace etiquette when several agents work on one repo
alwaysApply: true
---

# Workspaces: stay in your own

Several `jj` workspaces share one repo. Each workspace owns its own working
copy and its own `@`. Your workspace is the directory you start in.

## The one rule

**Do not modify another workspace.**

You can read one. The commit store is shared, so `jj log` and `jj diff -r` show
another workspace's commits from your own directory. You can also read its
files.

## Forbidden

- Edit a file in another workspace, or run a build or a test that writes into
  it.
- Run a `jj` command from inside another workspace. It snapshots that working
  copy. Run `jj` from your own directory.
- `jj edit` onto a commit another workspace has checked out. Both workspaces
  snapshot into it, and one change id gets rewritten two ways. That is a
  divergent change id.
- Rebase, abandon, squash or split a commit another workspace sits on or
  descends from.
- Move a bookmark another workspace is based on.

## Starting one

- If pizj mode is active, use `pizj_open_workspace`. It opens a zellij tab with
  its own session. Do not start modifying work in a background agent.
- Each zellij tab owns one jj workspace. All panes and agents in the tab use
  that workspace directory.
- The tool returns the exact workspace path. Give agents that path.
- Base a workspace on a fixed revision. Do not base it on a bookmark you will
  keep moving.
- A workspace agent gets one concrete deliverable. Its fork policy is `deny` by
  default. It reports newly discovered work to its parent.

## What is genuinely shared

Anything at a fixed path outside the repo. A test recipe that hardcodes a
scratch home or a keychain permits one run at a time. Serialize those with a
lock. Write the holder's pid into the lock, so you can tell an orphan from a
live run.

## Integration

Only the session that started the workspaces integrates them. It waits until
every workspace reports and stops. Then it rebases the finished commits into
one stack and removes the workspaces. A history change needs permission first.
See `vcs.md`.
