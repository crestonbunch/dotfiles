---
description: Subagent routing, model choices, and task-sized delegation
alwaysApply: true
---

# Preferences

- Follow repo conventions and user authority. Default parent: GPT-6 Sol/medium. The parent owns scope, plan, cross-lane contracts, findings, integration, and acceptance; a child's recommendation is evidence, not approval.
- Delegate liberally for typical and large work. Do small, fast changes directly. A batch of small changes can be partitioned among workers/builders; review the combined result if significant.
- Astra/low and Astra/medium may be chosen autonomously for judgment. Astra/high requires an explicit user prompt, for parent or child. Set effort explicitly and use the cheapest capable model, context, and tools; do not escalate for reassurance alone.

## Roles

Provider: `openai-codex`. Defaults, not fixed limits:

| Agent | Model | Effort | Use |
| --- | --- | --- | --- |
| `explorer` | `gpt-6-luna` | high | Bounded read-only discovery across code, MCP, and web sources |
| `advisor` | `gpt-6-astra` | medium | Recommend decisions and implementation direction; parent approves |
| `worker` | `gpt-6-sol` | medium | Mechanical edits, existing features, plumbing, debugging |
| `builder` | `gpt-6-sol` | high | Larger new features and novel technical designs |
| `reviewer` | `gpt-6-luna` | high | Fresh read-only review of the final candidate; use Sol if deeper review is needed |

Verify discovered agents, resolved models, tools, and project overrides before launch. If a task exceeds a child's boundary, it returns the evidence and unresolved question to the parent; no silent model fallback or scope expansion.

## Workflow

- **Large:** explorer gathers evidence → advisor recommends direction → parent approves plan → one or more builders implement → parent integrates task-owned workspaces → reviewer checks the combined result. Use separate workspaces for parallel writers when worthwhile; do not create them by default.
- **Typical:** explorer gathers context → worker or builder implements → reviewer checks the final result. Skip redundant discovery if the necessary evidence is already available; scale review to the change.
- **Small/fast:** do it directly, without subagents. For many small tasks, partition independent slices across workers/builders; review if the combined change is significant.
- Start each child with `context: "fresh"` and a self-contained task packet: objective, cwd/ref, relevant evidence, authority and files/contracts, expected result, validation, and stop conditions. Use `context: "fork"` only when essential history cannot fit in a compact handoff, and explain why. Inherited repository/operator rules are not the parent's conversation history.
- Keep the parent as coordinator, not a duplicate implementer. Children do not delegate or broaden their assignments. Use async scripted workflows for coordinated fanout; steer only the relevant live child. On launch/tooling failure, stop that lane, preserve its state, and report the failure before retrying through the same protocol.

## Workspaces, review, and completion

- One writer per cwd/workspace. For parallel writers, allocate separate jj workspaces based on recorded revisions, exclusive files/contracts, and an integration order. Read-only review targets an exact revision or frozen candidate, not a moving target. Coordinate shared test/build resources. Follow `jj.md` for VCS ownership and commits.
- This workflow authorizes integration of task-owned workspace changes only. Integrate serially, validate the combined result, forget integrated workspaces and abandon task-owned empty revisions per `jj.md`; do not delete directories or rewrite unrelated history without permission.
- Use a fresh reviewer on the final integrated result for large/typical work and significant small-task batches. Parent resolves findings, verifies design coherence and validation, and makes the final acceptance decision. No unrequested push, PR, merge to a shared branch, deploy, or destructive cleanup.
