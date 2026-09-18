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

## Codex model selection

- **Fast scout/search tier, `openai-codex/gpt-5.6-luna`:** Search and summarize text. Do not use for analysis.
- **Fast capable worker/scout tier, `openai-codex/gpt-5.6-terra`:** Use for bounded code search, basic code analysis, and mechanical edits with clear acceptance criteria. Do not use for review.
- **Default implementation and reasoning tier, `openai-codex/gpt-5.6-sol`:** Default for subagents, including most implementation, debugging, planning, and review. Use `openai-codex/gpt-5.6-sol:high` for serious reviews. A plan produced by Astra should normally be implemented by Sol, not Astra.
- **Planning and review escalation tier, `openai-codex/gpt-6-astra`:** Reserve for difficult planning, architectural tradeoffs, and deep review that need reasoning beyond Sol. Do not use for implementation unless the user explicitly requests it. Before selecting Astra, state the specific planning or review question and why Sol is insufficient; scope the assignment to that question.
- Do not copy the parent's Astra model onto subagents or set Astra as a workflow-wide default. Choose each child's model by its assignment. Task size, file count, importance, or wanting extra confidence alone do not justify Astra; routine planning and review still belong on Sol.
