---
description: Error handling (Ousterhout, A Philosophy of Software Design)
alwaysApply: true
---

# Error handling: reduce the number of places errors must be handled

- Exceptions and error conditions add disproportionate complexity, because each
  one is a special case a caller must handle. Prefer designs that have fewer
  exceptions to handle, not more. Don't define errors that don't need to exist.
- **Define errors out of existence.** Redesign the API's semantics so the
  condition is no longer an error (e.g. return an empty result instead of
  throwing on "not found"; make an operation idempotent so "already done" isn't
  a failure). This is the best option and should be the first thing you reach
  for.
- For exceptions that can't be defined away:
  - **Mask them at a low level** so their impact is contained and higher layers
    never see them.
  - **Aggregate** several special-case handlers into a single, more generic
    handler rather than sprinkling handling throughout the code.
- Applied together, these techniques significantly reduce overall system
  complexity.
