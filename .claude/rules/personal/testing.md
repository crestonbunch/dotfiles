---
description: Writing tests (Software Engineering at Google)
alwaysApply: true
---

# Testing: strive for unchanging tests

A good test never needs to change unless the system's requirements change. Every
edit to an old test is time not spent on real work. Optimize for that.

- **Test via public APIs.** Invoke the system the way its users would, not
  through implementation details. Testing internals makes tests brittle.
- **Test state, not interactions.** Assert on the result the system produces, not
  the sequence of calls it made on its collaborators. Interaction tests check
  *how* a result was reached and break when the implementation changes; usually
  only the *what* matters.
- **Test behaviors, not methods.** Don't mirror one test per production method —
  that couples test complexity to code structure. A behavior is one
  given/when/then unit; a single method may have several behaviors, and one
  behavior may span several methods.
- **Structure tests around given/when/then** and keep that structure explicit.
- **Name tests after the behavior** being tested, not the method.
- **No logic in tests.** A test should be trivially correct on inspection. Avoid
  conditionals, loops, and computation; each test handles one concrete set of
  inputs, so spell them out.
- **Prefer DAMP over DRY.** Descriptive And Meaningful Phrases beat strict
  deduplication — a little duplication is fine when it makes a test clearer and
  self-contained.
- **Make tests complete and concise**, and **write clear failure messages** that
  say what was expected versus what happened.
