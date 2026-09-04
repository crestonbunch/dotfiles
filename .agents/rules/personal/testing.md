---
description: Test design and review; Software Engineering at Google
alwaysApply: true
---

# Testing

- **Unchanging tests.** Refactors, features, and bug fixes should preserve existing tests. Add coverage for new behavior and missed cases. Update expectations for changed requirements. Refactor breaks a test? Check for behavior changes or the wrong test boundary before editing expectations.
- **Public APIs.** Test the chosen unit's consumer-facing contract, not every language-public method. Helpers through callers; reusable units can have their own tests.
- **State over interactions.** Assert results and observable state. Interactions when state testing is impractical or the call itself matters: required effects, expensive-call limits. Prefer state-changing calls; avoid incidental call counts, arguments, and ordering.
- **Behaviors, not methods.** One behavior per test; clear given/when/then. Names convey action, outcome, and relevant conditions.
- **No test logic.** Straight-line code; explicit inputs and expected values. No mental computation to find the expected answer. Avoid loops, branches, and derived expectations, even string concatenation. Assertion syntax and clear construction helpers are fine; don't reproduce production logic.
- **DAMP over DRY.** Complete, concise, self-contained tests. Duplication is fine. Share setup only when clearer; keep behavior-relevant details visible.
- **Useful failures.** Expected result, actual result, relevant inputs.

Sources: *Software Engineering at Google*, [ch. 12](https://abseil.io/resources/swe-book/html/ch12.html) and [ch. 13](https://abseil.io/resources/swe-book/html/ch13.html) (interaction-testing exceptions).
