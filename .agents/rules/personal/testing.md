---
description: Test design and review
alwaysApply: true
---

# Testing

- Preserve existing tests for refactors and behavior-preserving fixes. Add tests for new behavior and missed cases; change expectations only for changed requirements.
- Test a unit's consumer-facing behavior through its public contract. Test helpers through callers unless independently reusable.
- Prefer observable state over call assertions; assert interactions only when the call itself matters or state is impractical to observe.
- One behavior per test, with a name and failure that explain the scenario and expected result.
- Keep tests straight-line, self-contained, and explicit. Avoid branches, loops, and computed expectations that reproduce production logic. Reuse straightforward setup when it keeps tests readable; duplicate only when clearer.
- Add the smallest regression coverage that demonstrates the changed contract and its important failure cases. Do not enumerate every input permutation, mirror every implementation guard, or build a new harness when existing fixtures suffice. Large test expansion for a small change needs a concrete risk justification.
