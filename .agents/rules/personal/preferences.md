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
- **Fast capable worker/scout tier, `openai-codex/gpt-5.6-terra`:** Search code and analyze basic code. Do not use for review.
- **Ordinary strong default and strong reviewer tier, `openai-codex/gpt-5.6-sol`:** Default for most problems. Use it to reason, make choices, plan, write, and review. Select `openai-codex/gpt-5.6-sol:high` for serious reviews.
- **Top-reasoning critic/oracle tier, `openai-codex/gpt-6-astra`:** Use for hard problems, deep reviews, and complex tasks. Use it to plan, write, and review.
