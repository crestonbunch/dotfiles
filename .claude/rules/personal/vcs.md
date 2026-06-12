---
description: Version control (jj/git) commit and history rules
alwaysApply: true
---

# Version control

- Never commit code on my behalf without asking first. Likewise, never modify
  VCS history (rebase, amend, reset, force-push, squash, etc.) without asking.
- Always use `jj` for VCS operations. Fall back to `git` only when there is no
  `jj` repo (i.e. no colocated `.jj` directory).
