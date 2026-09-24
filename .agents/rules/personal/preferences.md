---
description: Subagent routing, model choices, and task-sized delegation
alwaysApply: true
---

# Preferences

- Default parent: GPT-6 Sol/medium. The parent owns scope, plan, contracts, integration, and acceptance; children advise or execute within assigned boundaries.
- Choose Astra/low or medium autonomously when useful. Astra/high requires an explicit user prompt. Set effort explicitly; use the cheapest capable model and context.

## Roles

Provider: `openai-codex`. Defaults, not fixed limits:

| Agent | Model | Effort | Use |
| --- | --- | --- | --- |
| `explorer` | `gpt-6-luna` | high | Bounded read-only discovery across code, MCP, and web sources |
| `advisor` | `gpt-6-astra` | medium | Recommend decisions and implementation direction; parent approves |
| `worker` | `gpt-6-sol` | medium | Mechanical edits, existing features, plumbing, debugging |
| `builder` | `gpt-6-sol` | high | Larger new features and novel technical designs |
| `reviewer` | `gpt-6-luna` | high | Fresh read-only review of the final candidate; use Sol if deeper review is needed |

Verify agents, models, tools, and project overrides before launch. Children return out-of-scope questions to the parent; no silent fallback or scope expansion.

## Delegation mechanics

- Skip redundant discovery. Review proportionately; parallel writers get separate workspaces only when worthwhile.
- Start children with `context: "fresh"` and a self-contained packet: goal, cwd/ref, evidence, authority, files/contracts, validation, and stop conditions. Fork only when essential history cannot fit, and say why. Inherited rules are not conversation history.
- Children neither delegate nor expand scope. Use async workflows for coordinated fanout. On tooling failure, stop the lane, preserve state, and report before retrying.

## Workspaces, review, and completion

- One writer per workspace; coordinate tests. Review an exact revision or frozen candidate. Follow `jj.md` for VCS ownership.
- Large-work routing in `~/.pi/agent/AGENTS.md` authorizes integrating task-owned workspace changes, not unrelated work. Validate the combined result; follow `jj.md` for cleanup.
- Use a fresh reviewer for large/typical work and significant small-task batches. The parent resolves findings and accepts the result. No unrequested push, PR, shared-branch merge, deploy, or destructive cleanup.
