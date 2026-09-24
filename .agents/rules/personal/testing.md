---
description: Test design and review
alwaysApply: true
---

# Testing

- Preserve existing tests for refactors and behavior-preserving fixes. Add tests for new behavior and missed cases; change expectations only for changed requirements.
- Test a unit's consumer-facing behavior through its public contract. Test helpers through callers unless independently reusable.
- Prefer observable state over call assertions; assert interactions only when the call itself matters or state is impractical to observe.
- One behavior per test, with a name and failure that explain the scenario and expected result.
- Keep tests straight-line, self-contained, and explicit. Avoid branches, loops, and computed expectations that reproduce production logic. Duplication is fine when clearer than shared setup.
