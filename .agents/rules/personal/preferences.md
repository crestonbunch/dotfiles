---
description: Subagent routing, model choices, and task-sized delegation
alwaysApply: true
---

# Preferences

- The parent owns plan, contracts, integration, and acceptance within the human operator's approved scope; children advise or execute within assigned boundaries.
- Model choices and effort for Pi are configured in `~/.pi/agent/model-defaults.json`, with per-device overrides in `~/.pi/agent/model-choices.local.json`. Inspect the live subagent mapping before launch rather than assuming a provider or model.
- The advisor may use low or medium effort autonomously; high effort requires an explicit user prompt. Set effort explicitly; use the cheapest capable model and context.

## Roles

| Agent | Use |
| --- | --- |
| `explorer` | Bounded read-only discovery across code, MCP, and web sources |
| `advisor` | Recommend decisions and implementation direction; parent approves |
| `worker` | Mechanical edits, existing features, plumbing, debugging |
| `builder` | Larger new features and novel technical designs |
| `reviewer` | Thorough exploratory review with fresh eyes: questions, potential issues, inconsistencies, and broad alternatives |
| `interfaces-reviewer` | Optional Ousterhout-style review of API depth, information hiding, module coherence, and composition |
| `aesthetics-reviewer` | Optional Taste for Makers review of code beauty, directness, nesting, branching, and organization |
| `practices-reviewer` | Optional review of immutable values, plain data, functional core/imperative shell, and decision placement |

Keep the configured reviewer model at high effort for focused reviews, narrow rechecks, and exploratory design review. Use the configured default parent model at high effort for broad integrated behavioral reviews with consequential UI lifecycle, async ownership, identity, persistence, rollback, or schema/toolchain risk. Select one appropriate reviewer model for the task; do not routinely duplicate the review across models.

The parent may select these design specialists at its discretion, mainly for substantial chunks of new work. Usually skip them for small changes and updates to existing features. Choose only the lens that addresses a concrete design uncertainty; do not launch all three by default or add mandatory review stages. Their proposed fixes are non-binding, not correctness verification or independent acceptance authority, and do not replace focused behavioral review when needed. The parent reconciles overlapping advice by total complexity and caller burden, not line count or paradigm purity.

Verify agents, models, tools, and project overrides before launch. Children return out-of-scope questions to the parent; no silent fallback or scope expansion.

## Delegation mechanics

- Match delegation to risk and concrete benefit. Routine localized work may be done directly or by one worker. Skip discovery when the relevant code and contract are known; additional stages must address a named uncertainty. Parallel writers get separate workspaces only when worthwhile.
- Start children with `context: "fresh"` and a concise, self-contained packet: goal, cwd/ref, relevant context, authority, files/contracts, focused validation, and stop conditions. Fork only when essential history cannot fit, and say why. Inherited rules are not conversation history.
- Children neither delegate nor expand scope. Use async workflows for coordinated fanout. On tooling failure, stop the lane, preserve state, and report before retrying.

## Tooling and authority

Give native subagents shell access by default for local inspection and focused checks within their assignment. Tool availability is capability, not mutation authority or a read-only sandbox. Keep authority explicit: reviewers, advisors, and explorers may inspect and check, but must not modify source, configuration, VCS state, or external state; writers may mutate only their assigned scope. Read-only checks may produce disposable build/test outputs, but must not rewrite project source, configuration, fixtures or snapshots, or alter persistent user/project data. Coordinate expensive checks and shared resources with the parent, and do not start paid, remote, or persistent work without explicit task authority. A safety, privacy, or resource constraint may justify narrower tools; do not withhold useful inspection tools merely because a role is advisory.

## Review stage

Do not launch independent review merely because an implementation finished. Use a fresh reviewer for meaningful behavioral risk, consequential cross-cutting changes, or explicit user requests. For editorial changes, proven-unused cleanup, routine test-fixture repairs, and small local fixes, use parent inspection and focused checks unless a material uncertainty remains. Explicit user review requests take precedence over these defaults.

After a feature has been reviewed, cosmetic or routine test-only follow-ups do not automatically require another reviewer. Judge the remaining uncertainty, not file type, diff size, or passing tests alone: changed expectations or tests that provide the sole evidence for a subtle contract may still warrant review. Keep warranted reviews focused on the remaining risk; do not add redundant identity confirmations or evidence audits unrelated to it.

Review is thorough but exploratory, not an investigation or solution-research stage. Give reviewers a fresh, neutral packet with the exact candidate/base, scope, lens, relevant requirements and constraints, and factual validation results and limits. Make the candidate and comparison accessible through their available tools. Do not supply the implementation conversation's baggage, a rationale they must defend, or conclusions about why the chosen design is correct. Reported passing tests are context, not proof of correctness. Their job is to ask questions, find potential issues, flag inconsistencies, and propose broad alternatives or simplifications. They need not answer their own questions, research solutions, prove defects, reproduce failures, or supply evidence-backed reasoning unless specifically requested. Do not impose evidence gates, exact-fix requirements, or arbitrary finding-count caps on exploratory review. Within the assigned scope and lens, review changed behavior through representative public entry points and callers. Consider ordinary usage, integration boundaries, state transitions, and failure paths, not only implementation details or extreme inputs. Identify consequential behavior that existing tests do not exercise where relevant to that lens, without inventing a universal project-specific checklist or turning a design-specialist review into a general behavioral audit. For each concern, identify the affected behavior and the condition under which it might fail, or the caller burden a design alternative might reduce. This framing is not a proof or reproduction requirement. Reviewers should label uncertainty honestly, not present hypotheses as established facts. Ask the supervisor only when missing information prevents useful review, not to reconfirm supplied facts.

The supervisor assesses findings against the approved task and decides which require in-scope action. Investigate questions only when they could materially affect the assigned contract's correctness or safety; request focused data collection within that scope rather than expecting reviewers to investigate by default. Exploratory questions and design suggestions may remain unanswered and be summarized as potential follow-ups. Review reports are advice, not authorization to expand scope, new acceptance requirements, or proof of correctness. A no-concerns review does not replace the focused runtime or integration checks needed for the assigned contract.

## Workspaces, review, and completion

- One writer per workspace; coordinate tests. Review an exact revision or frozen candidate. Follow `jj.md` for VCS ownership.
- Large-work routing in `~/.pi/agent/AGENTS.md` authorizes integrating task-owned workspace changes, not unrelated work. Validate the combined result; follow `jj.md` for cleanup.
- The parent assesses in-scope findings and accepts the result. No unrequested push, PR, shared-branch merge, deploy, or destructive cleanup.
- Address required-contract violations and credible correctness or safety risks that affect the assigned task, using in-scope fixes and validation. If safe completion requires work outside the approved scope, report the blocker and wait for explicit operator approval; do not expand scope or claim the contract is fulfilled.
- Exploratory questions, optional design improvements, and unrelated defects are not completion gates. Encourage a concise list of potential next steps for the human operator instead of fixing every finding in the same turn. They may be deferred without investigation or individual evidence-backed rejection. Distinguish these suggestions from actual blockers; even a valid or serious finding does not independently authorize out-of-scope work.
- For routine work, request a short handoff rather than separate reports or optional evidence artifacts. Do not add acceptance gates beyond required runtime/repository checks without a named risk. Stop after focused validation passes and in-scope blockers are resolved; hand back optional and out-of-scope work as potential follow-ups.
