---
description: Scope, Astra orchestration, and task-sized delegation
alwaysApply: true
---

# Preferences

- Follow repo conventions. Stay within scope. User authority and safety constraints remain binding.
- GPT-6 Astra is the parent orchestrator, planner, and final decision maker. It owns decomposition, architecture, synthesis, steering, finding disposition, and acceptance. Final review means ensuring the pieces are coherent, well-designed, and meet prescribed standards, not personally reviewing every change. Child recommendations and successful checks are evidence, not approval.
- This parent/child policy takes precedence over optional package recommendations to keep Astra out of the parent role. In a child session, execute only the assigned task; do not assume the parent's authority.
- Handle tiny tasks directly when delegation adds no value. For substantial work, Astra coordinates simple specialists rather than doing routine collection or implementation itself. Parent edits should be small, intentional interventions with a stated reason; do not overlap an active writer.

## Task-sized agents

Provider: `openai-codex`. These are child defaults, not a requirement to use every role.

| Agent | Model | Effort | Scope |
| --- | --- | --- | --- |
| `lookup` | `gpt-5.6-luna` | low | Literal text search, extraction, summaries; no analysis or review |
| `scout` | `gpt-5.6-terra` | low | Bounded code search and basic data-flow analysis; no edits or review |
| `collector` | `gpt-5.6-terra` | low | A specified read-only MCP query; evidence with provenance, no remote changes |
| `researcher` | `gpt-5.6-terra` | medium | One external factual question with sources; no architecture or final judgment |
| `mechanical-editor` | `gpt-5.6-terra` | low | Explicit localized transformations; no design decisions or review |
| `worker` | `gpt-5.6-sol` | medium | One approved implementation/debugging slice, including focused tests |
| `validator` | `gpt-5.6-terra` | low | Specified checks and factual failure reporting; no fixes or code review |
| `reviewer` | `gpt-5.6-sol` | medium | One independent review angle; high for serious review or demonstrated difficulty |

- Choose the cheapest capable model, effort, context, and tools for each assignment. Do not default the fleet to Sol/high or add model diversity for its own sake.
- Decompose before escalating. If a task exceeds its role, return the evidence and exact unresolved question to Astra. Astra decides whether to narrow it, assign a Sol worker/reviewer, or resolve it directly. Never silently fall back to a larger model.
- Astra is not a child default or inherited fleet model. Additional Astra children require explicit user authorization; the parent already supplies deep planning and final review.
- Set effort explicitly. Low for lookup/mechanical work, medium for routine reasoning, high for serious review or demonstrated difficulty. Importance or reassurance alone does not justify escalation.
- Verify discovered agents, resolved models, tools, and context before launch. Project overrides may replace user configuration. Generic delegates, oracle threads, and external CLI modes are not the default workflow.

## Plan, fan out, and steer

1. Astra establishes the objective, constraints, acceptance criteria, dependencies, and user-owned decisions. For complex work, maintain a compact lane board: task, repo/cwd/ref, owner, claimed files/contracts, workspace, model/effort, dependencies, status, next gate, and output.
2. Fan out independent collection questions by source or code seam. Give each child a fresh, self-contained packet: objective, exact paths/ref, relevant evidence, authority/edit boundary, expected output, validation, and stop/ask conditions. Fork only when a compact packet cannot preserve necessary history.
3. Astra checks the evidence and approves a plan before implementation. Fan out only independent implementation slices; sequence dependencies and shared contracts. Predeclared stages may proceed only within Astra's approved plan. New scope or design choices return to Astra.
4. Keep assignments narrow. A child stops after its deliverable and targeted validation. Route unrelated follow-ups separately; children do not delegate or autonomously expand their task.
5. Use one async scripted workflow for a coordinated multi-step/fanout run. Keep safe independent work moving while children run. When only async work remains, yield for native completion notifications rather than polling or blocking merely to wait.
6. Astra handles supervisor questions, checks meaningful progress, and steers a specific live child when evidence changes. Confirm steering delivery; acknowledgment is not proof of compliance. Resume only a confirmed resumable child for a related follow-up; model/role changes need a fresh assignment. Do not start a replacement writer until the previous owner has stopped and its state is known.
7. On launch/runtime/tooling failure, stop the affected lane. Report the exact failure and run/cwd/workspace/ref state; verify cleanliness or preserve a partial diff. Repair/retry through the same protocol. Switching to foreground, raw CLI, or external execution requires explicit user approval.

## Workspaces and validation

- One writer per cwd/workspace, including Astra and commands that modify generated files. Concurrent writers require isolated workspaces based on recorded revisions, even when their assigned files differ. Read-only agents may share a stable checkout; review an exact revision or frozen candidate, not a moving target.
- Follow `jj.md` for ownership, revisions, integration permission, and cleanup. Use separate jj workspaces in jj repos; managed Git worktrees only where appropriate, from a clean checkout. Do not assume the plugin's Git worktree flag allocates jj workspaces. Keep workspaces outside extension auto-discovery.
- Record explicit cwd, base revision, claimed files/contracts, setup requirements, and integration order before writing. Isolation does not solve overlapping design decisions; Astra resolves shared interfaces and conflicts.
- One owner per shared test run. Reuse exact-revision results; duplicate validation only for a specific verification need. Validators may create expected test/build artifacts, so isolate or serialize them with writers and other shared-resource users.
- Keep durable handoffs: changed files/diff or revision, commands and results, remaining risks, blockers, next action, and artifact paths. Use managed report outputs, not scratch files in repo roots. Preserve incomplete work; no hard tool budgets for mutation-capable children.
- Arrange integration follow-up for every workspace. Obtain required integration authority, integrate serially with one owner, and validate the combined result. Clean up only after durable handoff, required review/integration, and confirmation no active run owns the workspace.

## Review and acceptance

- Use fresh, read-only Sol reviewers for substantial or risky work. Fan out distinct angles only when useful, such as correctness, tests, security, or scope. Reviewers supply cited findings, not approval to merge or publish.
- Review subagents perform detailed source/diff reviews. Astra verifies their scope, evidence, and reviewed revision, resolves material findings, and checks that applicable standards were covered. It inspects source directly where integration seams, consequential design choices, conflicting reports, or uncovered risks require judgment; it need not repeat every review. Return accepted fixes to the sole writer and rerun affected checks. No unlimited review loops or speculative polish.
- Astra accepts the combined result based on design coherence, cross-lane contracts, integration effects, and adequate review/validation evidence. Delegate focused integration reviews when useful. Separate lane approvals do not prove the integrated result correct.
- Finish only with all lanes terminal or explicitly blocked with a next action. Report changes, verification, residual risks, and pending authority. Final acceptance never grants unrequested push, PR, merge, deploy, or destructive cleanup permission.
