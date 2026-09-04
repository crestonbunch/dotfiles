---
description: Module boundaries and interfaces; John Ousterhout
alwaysApply: true
---

# Module design

Goal: less complexity and coupling, not more classes or layers.

- **Deep modules.** Much functionality behind a simple interface. Judge benefit against caller learning cost, not line count. Small classes aren't inherently better.
- **Whole contract = interface.** Behavior, side effects, constraints, signatures, fields. Document what callers need; short signatures can hide complex contracts.
- **Information hiding.** Each module owns knowledge/design decisions. Expose only what's needed. Private fields don't prevent behavioral or back-door leakage.
- **Knowledge over execution order.** Don't create a module per step merely because steps run sequentially. Bring shared representation/decision knowledge together. Sequential execution is fine; leaked knowledge is the problem.
- **Distinct abstractions per layer.** Pass-throughs and shallow wrappers are warning signs. What value and hidden knowledge justify another interface?
- **Somewhat general-purpose.** Simple API covering current needs beyond one special case. Common operations easy; no speculative features.
- **Pull complexity downward.** Solve inside the module instead of pushing difficult choices/configuration onto callers. Simple interface over superficially simple implementation. Recovery: see `error-handling.md`.

Boundary questions: unique value? Knowledge enabling it? Minimum exposure?

Sources: Ousterhout, *A Philosophy of Software Design*, ch. 4-8; [CS 190 notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign). Operational paraphrases grounded in the author's notes.
