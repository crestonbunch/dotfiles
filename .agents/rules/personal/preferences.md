---
description: Scope and delegation preferences
alwaysApply: true
---

# Preferences

- Follow repo conventions. Stay within scope.
- Do small tasks directly; delegate bounded work, async decisions, research, or review. Use available agents; verify results.

## Lean delegation

- Parallelize independent tasks; sequence dependencies. Give writers separate workspaces and arrange integration.
- One owner per shared test run; reuse results. Duplicate validation only for a specific verification need.
- Default to fresh context: objective, paths, constraints, evidence, deliverable. Fork history only when a compact handoff cannot preserve needed context.
- Choose the cheapest capable model, effort, and context per task, not Sol/high by habit. Match models to work, not diversity quotas.
- Set effort explicitly: low for lookup/mechanical work, medium for routine reasoning, high for serious review or demonstrated difficulty. Escalate on evidence, not reassurance.
- Keep assignments narrow. Route unrelated follow-ups separately. Report and stop after targeted validation.

## Codex models

Provider: `openai-codex`.

- `gpt-5.6-luna`: text search and summaries; no analysis.
- `gpt-5.6-terra`: bounded code search, basic analysis, mechanical edits; no review.
- `gpt-5.6-sol`: implementation, debugging, planning, review beyond fast-tier capability. Normally implements Astra plans.
- `gpt-6-astra`: difficult planning, architecture, deep review beyond Sol. State the specific question and why Sol is insufficient. Implementation requires explicit user request.
- Never inherit Astra or default entire workflows to it. Size, importance, and extra confidence alone don't justify escalation.
