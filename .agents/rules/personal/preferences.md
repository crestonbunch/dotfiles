---
description: Scope, model routing, and task-sized delegation
alwaysApply: true
---

# Preferences

- Follow repo conventions. Stay within scope. User authority and safety constraints remain binding.
- Default parent: GPT-6 Sol at medium effort. The parent owns decomposition, architecture, synthesis, steering, finding disposition, and acceptance, regardless of model. Final review means ensuring the pieces are coherent, well-designed, and meet prescribed standards, not personally reviewing every change. Child recommendations and successful checks are evidence, not approval.
- Choose GPT-6 Astra at low or medium autonomously when the task benefits from its judgment, such as ambiguous planning, complex synthesis, or consequential tradeoffs. Use Astra at high only when the user explicitly prompts for Astra/high; task importance alone does not authorize it. This applies to parent and child model choices. In a child session, execute only the assigned task; do not assume the parent's authority.
- Handle tiny tasks directly when delegation adds no value. For substantial work, the parent coordinates simple specialists rather than doing routine collection or implementation itself. Parent edits should be small, intentional interventions with a stated reason; do not overlap an active writer.

## Task-sized agents

Provider: `openai-codex`. These are child defaults, not a requirement to use every role.

| Agent | Model | Effort | Scope |
| --- | --- | --- | --- |
| `lookup` | `gpt-6-luna` | low | Literal text search, extraction, summaries; no analysis or review |
| `scout` | `gpt-6-luna` | medium | Bounded code search and basic data-flow analysis; no edits or review |
| `collector` | `gpt-6-luna` | low | A specified read-only MCP query; evidence with provenance, no remote changes |
| `researcher` | `gpt-6-luna` | medium | One external factual question with sources; no architecture or final judgment |
| `mechanical-editor` | `gpt-6-luna` | low | Explicit localized transformations; no design decisions or review |
| `worker` | `gpt-6-sol` | medium | One approved implementation/debugging slice, including focused tests |
| `validator` | `gpt-6-luna` | low | Specified checks and factual failure reporting; no fixes or code review |
| `reviewer` | `gpt-6-luna` | high | One independent review angle; use Sol when extra depth is needed |

- Choose the cheapest capable model, effort, context, and tools for each assignment. Luna and Sol are available at low, medium, and high; Luna/high is a strong option for serious review. Do not default the fleet to Sol/high or add model diversity for its own sake.
- Decompose before escalating. If a task exceeds its role, return the evidence and exact unresolved question to the parent. The parent decides whether to narrow it, change to Luna/high or Sol at an appropriate effort, use Astra/low or Astra/medium for judgment, or resolve it directly. Never silently fall back to a larger model.
- Astra/low and Astra/medium may be chosen autonomously for bounded parent or child work that warrants them. Astra/high requires an explicit user prompt; do not infer permission from a difficult task.
- Set effort explicitly. Low for lookup/mechanical work, medium for routine reasoning, high for serious review or demonstrated difficulty on Luna or Sol. Importance or reassurance alone does not justify escalation.
- Verify discovered agents, resolved models, tools, and context before launch. Project overrides may replace user configuration. Generic delegates, oracle threads, and external CLI modes are not the default workflow.

## Plan, fan out, and steer

1. The parent establishes the objective, constraints, acceptance criteria, dependencies, and user-owned decisions. For complex work, maintain a compact lane board: task, repo/cwd/ref, owner, claimed files/contracts, workspace, model/effort, dependencies, status, next gate, and output.
2. Fan out independent collection questions by source or code seam. Give each child a fresh, self-contained packet: objective, exact paths/ref, relevant evidence, authority/edit boundary, expected output, validation, and stop/ask conditions. Fork only when a compact packet cannot preserve necessary history.
3. The parent checks the evidence and approves a plan before implementation. Fan out only independent implementation slices; sequence dependencies and shared contracts. Predeclared stages may proceed only within the parent's approved plan. New scope or design choices return to the parent.
4. Keep assignments narrow. A child stops after its deliverable and targeted validation. Route unrelated follow-ups separately; children do not delegate or autonomously expand their task.
5. Use one async scripted workflow for a coordinated multi-step/fanout run. Keep safe independent work moving while children run. When only async work remains, yield for native completion notifications rather than polling or blocking merely to wait.
6. The parent handles supervisor questions, checks meaningful progress, and steers a specific live child when evidence changes. Confirm steering delivery; acknowledgment is not proof of compliance. Resume only a confirmed resumable child for a related follow-up; model/role changes need a fresh assignment. Do not start a replacement writer until the previous owner has stopped and its state is known.
7. On launch/runtime/tooling failure, stop the affected lane. Report the exact failure and run/cwd/workspace/ref state; verify cleanliness or preserve a partial diff. Repair/retry through the same protocol. Switching to foreground, raw CLI, or external execution requires explicit user approval.

## Workspaces and validation

- One writer per cwd/workspace, including the parent and commands that modify generated files. Concurrent writers require isolated workspaces based on recorded revisions, even when their assigned files differ. Read-only agents may share a stable checkout; review an exact revision or frozen candidate, not a moving target.
- Follow `jj.md` for ownership, revisions, integration permission, and cleanup. Use separate jj workspaces in jj repos; managed Git worktrees only where appropriate, from a clean checkout. Do not assume the plugin's Git worktree flag allocates jj workspaces. Keep workspaces outside extension auto-discovery.
- Record explicit cwd, base revision, claimed files/contracts, setup requirements, and integration order before writing. Isolation does not solve overlapping design decisions; the parent resolves shared interfaces and conflicts.
- One owner per shared test run. Reuse exact-revision results; duplicate validation only for a specific verification need. Validators may create expected test/build artifacts, so isolate or serialize them with writers and other shared-resource users.
- Keep durable handoffs: changed files/diff or revision, commands and results, remaining risks, blockers, next action, and artifact paths. Use managed report outputs, not scratch files in repo roots. Preserve incomplete work; no hard tool budgets for mutation-capable children.
- Arrange integration follow-up for every workspace. Obtain required integration authority, integrate serially with one owner, and validate the combined result. Clean up only after durable handoff, required review/integration, and confirmation no active run owns the workspace.

## Review and acceptance

- Use fresh, read-only Luna/high or Sol reviewers for substantial or risky work. Fan out distinct angles only when useful, such as correctness, tests, security, or scope. Reviewers supply cited findings, not approval to merge or publish.
- Review subagents perform detailed source/diff reviews. The parent verifies their scope, evidence, and reviewed revision, resolves material findings, and checks that applicable standards were covered. It inspects source directly where integration seams, consequential design choices, conflicting reports, or uncovered risks require judgment; it need not repeat every review. Return accepted fixes to the sole writer and rerun affected checks. No unlimited review loops or speculative polish.
- The parent accepts the combined result based on design coherence, cross-lane contracts, integration effects, and adequate review/validation evidence. Delegate focused integration reviews when useful. Separate lane approvals do not prove the integrated result correct.
- Finish only with all lanes terminal or explicitly blocked with a next action. Report changes, verification, residual risks, and pending authority. Final acceptance never grants unrequested push, PR, merge, deploy, or destructive cleanup permission.
