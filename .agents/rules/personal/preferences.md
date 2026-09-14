---
description: Scope and delegation preferences
alwaysApply: true
---

# Preferences

- Follow repo conventions. Stay within scope.
- Work directly by default. Delegate for useful independent research, review, or isolated implementation.
- Available agents only. Specific assignments; review results before use.

## Codex model selection

- **Fast scout/search tier, `openai-codex/gpt-5.6-luna`:** Search and summarize text. Do not use for analysis.
- **Fast capable worker/scout tier, `openai-codex/gpt-5.6-terra`:** Use for bounded code search, basic code analysis, and mechanical edits with clear acceptance criteria. Do not use for review.
- **Default implementation and reasoning tier, `openai-codex/gpt-5.6-sol`:** Default for subagents, including most implementation, debugging, planning, and review. Use `openai-codex/gpt-5.6-sol:high` for serious reviews. A plan produced by Astra should normally be implemented by Sol, not Astra.
- **Planning and review escalation tier, `openai-codex/gpt-6-astra`:** Reserve for difficult planning, architectural tradeoffs, and deep review that need reasoning beyond Sol. Do not use for implementation unless the user explicitly requests it. Before selecting Astra, state the specific planning or review question and why Sol is insufficient; scope the assignment to that question.
- Do not copy the parent's Astra model onto subagents or set Astra as a workflow-wide default. Choose each child's model by its assignment. Task size, file count, importance, or wanting extra confidence alone do not justify Astra; routine planning and review still belong on Sol.
