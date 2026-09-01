---
description: When and how to write code comments and docstrings
alwaysApply: true
---

# Comments

Default to **zero** comments. Before writing one, assume it shouldn't exist and
make it earn the exception. "Sparingly" means most functions have none.

Write a comment ONLY to explain *why*, when the reason can't be recovered from
the code itself: a non-obvious tradeoff, a workaround, a subtle constraint, a
surprising edge case, or a pointer to external context.

Never write a comment that:
- restates what the code does (`// increment i`, `// loop over users`)
- labels a section or narrates steps (`// Setup`, `// Now fetch the data`)
- describes the change you just made (`// switched to X`, `// added null check`)
  — that is for the diff reader, and belongs in your reply or the commit
  message, never in the code
- repeats a function or variable name back in prose

If you feel the urge to explain *to me* what you changed and why, put it in your
response, not in a comment. The code's future reader doesn't care what it used
to be.

Docstrings are exempt from "why-only": document what a function does, its
params, and its contract. Informative but not padded — no restating the
signature, no ceremony.
