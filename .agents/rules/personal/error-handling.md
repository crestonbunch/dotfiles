---
description: Error design and recovery
alwaysApply: true
---

# Error handling

Reduce failure cases callers must handle:

- Design away unnecessary errors with useful semantics, without misreporting failure as success or violating established contracts.
- Recover locally only when the contract can still be fulfilled. Never swallow an error as a substitute for recovery.
- Handle failures with the same response at one boundary, not separately at each step.
- If the caller cannot usefully respond, reconsider the API or handling boundary.
- Stop and report with diagnostic context when recovery is unsafe or impossible.
