---
name: new-workspace
description: Move a task into a jj workspace under ~/.workspaces, fork the current agent conversation into it, and open a zellij tab. Use when the user agrees to start a separate workstream, or asks for a new workspace, worktree, or parallel task.
---

# Start a task in a new workspace

A `jj` workspace gives the task a second working copy in the same repo. The
current working copy stays untouched. The new task gets its own revision,
agent conversation, and pull request.

`new-workspace.sh` creates the workspace and forks the conversation of the
calling agent. It supports Pi, Codex, Claude Code, and OpenCode. The script
detects the agent and session from the environment. Do not write a context
file or start an agent with a summary prompt.

Do not start the new task in the current session.

## 1. Read the state of the repo

```bash
jj workspace root
jj st
jj log --no-graph -r 'trunk()..@' -T 'change_id.short() ++ " " ++ description.first_line() ++ "\n"'
```

If there is no jj repo, tell the user and stop.

## 2. Decide three things

- **Slug**: use two to four kebab-case words, such as `fix-login-timeout`.
  The workspace name becomes `<repo-name>-<slug>`.
- **Base revision**: use `trunk()` by default. Use `@` only when the task needs
  code from the current working copy. Run `jj git fetch` first when the task
  needs the current remote trunk.
- **Title**: use an imperative sentence for the new revision description.
  Follow the pull request title rules because the pull request inherits it.

Tell the user which base revision you use.

## 3. Run the script

```bash
~/.agents/skills/new-workspace/new-workspace.sh create <slug> \
  --base 'trunk()' \
  --message "<title>"
```

Do not pass an agent name. The script must fork the conversation from the
agent that calls it.

The script prints `workspace_name`, `workspace_path`, `base_revision`, `agent`,
`source_session`, and `tab`. jj and zellij write to stderr.

The supported session variables are:

- Pi: `PI_SESSION_FILE`
- Codex: `CODEX_THREAD_ID`
- Claude Code: `CLAUDE_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`
- OpenCode: `OPENCODE_SESSION_ID`

The script accepts `--session <id-or-path>` when the harness identifies the
agent but does not export its session. Use this option only with the current
conversation.

Use `--no-tab` when zellij must not open a tab. Run the script with `--help`
for all options.

## 4. Report

Give the user the agent, workspace path, and base revision from the script
output. If the output has `tab=none`, give the user the `run=` command.

## 5. Remove the workspace after the work merges

```bash
~/.agents/skills/new-workspace/new-workspace.sh remove <workspace_name>
```

Run the command from the main repo. Close the zellij tab first:

```bash
zellij action go-to-tab-name <slug> && zellij action close-tab
```

The script forgets the workspace and deletes its workspace and launch files.
If jj reports a stale working copy, run `jj workspace update-stale` in that
workspace.
