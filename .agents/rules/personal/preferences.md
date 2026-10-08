---
description: Subagent routing, model choices, and task-sized delegation
alwaysApply: true
---

# Preferences

- Default parent: GPT-6.1 Sol/high. The parent owns scope, plan, contracts, integration, and acceptance; children advise or execute within assigned boundaries.
- Choose Astra/low or medium autonomously when useful. Astra/high requires an explicit user prompt. Set effort explicitly; use the cheapest capable model and context.

## Roles

Provider: `openai-codex`. Defaults, not fixed limits:

| Agent | Model | Effort | Use |
| --- | --- | --- | --- |
| `explorer` | `gpt-6-luna` | high | Bounded read-only discovery across code, MCP, and web sources |
| `advisor` | `gpt-6-astra` | medium | Recommend decisions and implementation direction; parent approves |
| `worker` | `gpt-6.1-sol` | medium | Mechanical edits, existing features, plumbing, debugging |
| `builder` | `gpt-6.1-sol` | high | Larger new features and novel technical designs |
| `reviewer` | `gpt-6-luna` | high | Fresh read-only review of the final candidate; use Sol if deeper review is needed |
| `interfaces-reviewer` | `gpt-6-luna` | high | Optional Ousterhout-style review of API depth, information hiding, module coherence, and composition |
| `aesthetics-reviewer` | `gpt-6-luna` | high | Optional Taste for Makers review of code beauty, directness, nesting, branching, and organization |
| `practices-reviewer` | `gpt-6-luna` | high | Optional review of immutable values, plain data, functional core/imperative shell, and decision placement |

The parent may select these design specialists at its discretion, mainly for substantial chunks of new work. Usually skip them for small changes and updates to existing features. Choose only the lens that addresses a concrete design uncertainty; do not launch all three by default or add mandatory review stages. Their proposed fixes are non-binding, not correctness verification or independent acceptance authority, and do not replace focused behavioral review when needed. The parent reconciles overlapping advice by total complexity and caller burden, not line count or paradigm purity.

Verify agents, models, tools, and project overrides before launch. Children return out-of-scope questions to the parent; no silent fallback or scope expansion.

## Delegation mechanics

- Match delegation to risk and concrete benefit. Routine localized work may be done directly or by one worker. Skip discovery when the relevant code and contract are known; additional stages must address a named uncertainty. Parallel writers get separate workspaces only when worthwhile.
- Start children with `context: "fresh"` and a concise, self-contained packet: goal, cwd/ref, relevant context, authority, files/contracts, focused validation, and stop conditions. Fork only when essential history cannot fit, and say why. Inherited rules are not conversation history.
- Children neither delegate nor expand scope. Use async workflows for coordinated fanout. On tooling failure, stop the lane, preserve state, and report before retrying.

## Workspaces, review, and completion

- One writer per workspace; coordinate tests. Review an exact revision or frozen candidate. Follow `jj.md` for VCS ownership.
- Large-work routing in `~/.pi/agent/AGENTS.md` authorizes integrating task-owned workspace changes, not unrelated work. Validate the combined result; follow `jj.md` for cleanup.
- Use a fresh reviewer for meaningful behavioral risk, broad changes, or explicit requests, not every small edit. The parent resolves findings and accepts the result. No unrequested push, PR, shared-branch merge, deploy, or destructive cleanup.
- Treat every raised review finding, including advisory design findings, as an issue requiring explicit disposition: fix it and run affected validation, or specifically reject it with a reason citing relevant code/file locations, contract, requirement, test evidence, or a concrete design tradeoff. Non-binding means the parent may disagree with the finding or choose a different fix, not silently ignore it. Optional status, low severity, or lack of a correctness defect alone is not a reason to disregard an issue. State each finding's disposition in the handoff; do not mark the task complete with accepted findings unresolved. If a fix exceeds approved scope or cannot safely be completed, report the unresolved issue and seek the needed decision rather than silently defer it.
- For routine work, request a short handoff rather than separate reports or optional evidence artifacts. Do not add acceptance gates beyond required runtime/repository checks without a named risk. Stop after focused validation passes and concrete blockers are resolved.
