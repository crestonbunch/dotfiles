---
description: Scope and delegation preferences
alwaysApply: true
---

# Preferences

- Follow repo conventions. Stay within scope.
- Work directly by default. Delegate for useful independent research, review, or isolated implementation.
- Available agents only. Specific assignments; review results before use.

## Lean delegation

- Keep subagent assignments lean and proportional to the task. Delegate bounded implementation, async decisions, focused research, or plan review with only the necessary context and clear deliverables. Don't inflate small fixes into broad audits or multi-stage workflows.
- Proactively fan out when multiple independent tasks can proceed concurrently. Give concurrent writers separate workspaces and arrange follow-up integration; keep dependencies sequenced. Use the fewest agents needed for the independent lanes, without redundant assignments.
- Assign shared validation to one owner and reuse the results. Don't have multiple agents run the same tests unless a specific independent verification need justifies it.
- Default to fresh-context subagents with a compact handoff: objective, relevant paths, constraints, evidence already gathered, and expected output. Fork full history only when the task genuinely depends on prior decisions or conversation details that a concise handoff cannot preserve. Don't inherit full history merely for convenience.
- Choose model, thinking effort, and context independently for each assignment. Use the least expensive capable combination, not Sol/high with full history by habit. Diverse tasks should use the appropriate model tiers below; don't force model diversity when it offers no benefit.
- Set thinking effort explicitly where supported: low for lookup and mechanical work, medium for routine implementation and bounded reasoning, high for serious reviews or demonstrated reasoning difficulty. Escalate after a concrete blocker or inadequate result, not preemptively for reassurance.
- Keep follow-up requests from extending an unrelated worker's scope. Handle independent small edits directly in a safe workspace or assign a separate bounded task. Once the deliverable and targeted validation are complete, have the worker report and stop.

## Codex model selection

- **Fast scout/search tier, `openai-codex/gpt-5.6-luna`:** Search and summarize text. Do not use for analysis.
- **Fast capable worker/scout tier, `openai-codex/gpt-5.6-terra`:** Use for bounded code search, basic code analysis, and mechanical edits with clear acceptance criteria. Do not use for review.
- **Implementation and reasoning tier, `openai-codex/gpt-5.6-sol`:** Use for implementation, debugging, planning, and review that need more reasoning than the fast tiers. Routine bounded work should use medium thinking, not high by default. Use `openai-codex/gpt-5.6-sol:high` for serious reviews or demonstrated reasoning difficulty. A plan produced by Astra should normally be implemented by Sol, not Astra.
- **Planning and review escalation tier, `openai-codex/gpt-6-astra`:** Reserve for difficult planning, architectural tradeoffs, and deep review that need reasoning beyond Sol. Do not use for implementation unless the user explicitly requests it. Before selecting Astra, state the specific planning or review question and why Sol is insufficient; scope the assignment to that question.
- Do not copy the parent's Astra model onto subagents or set Astra as a workflow-wide default. Choose each child's model by its assignment. Task size, file count, importance, or wanting extra confidence alone do not justify Astra; routine planning and review still belong on Sol.
