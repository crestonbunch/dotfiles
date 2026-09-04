---
description: VCS ownership, history edits, and jj workspaces
alwaysApply: true
---

# jj / VCS

- Prefer jj in jj workspaces; otherwise use the repo's VCS.
- Before edits: check `jj status` and current revision. `jj new` when needed to separate work; don't disrupt another agent's active revision.
- On completion, `jj commit` the task's changes with a descriptive message. Don't leave completed edits in an uncommitted working-copy revision. The fresh empty revision left by `jj commit` is fine. Commit only task-owned changes; resolve mixed ownership before finishing.
- **Owned** = assigned to this task, no other worker's changes. Current/unpublished does not imply owned.
- Autonomous describe/split/squash/rebase/abandon: owned, unpublished revisions only; preserve user work and don't affect other agents.
- Before rewriting: inspect affected descendants and workspace ownership. jj can rewrite descendants automatically.
- Ask before shared/published history edits, discarding user work, or force-push. Unclear ownership? Ask.
- Read-only review: `--ignore-working-copy` avoids snapshotting concurrent edits; sees recorded state, not unsnapshotted changes.
- Git-only: no commits unless requested. Bookmarks/PR creation: permission required unless already requested.

## Workspaces

- One writer per workspace. Large changes: separate jj workspace under `~/.workspaces/`, fixed base revision.
- Await explicit integration instructions. No main-line integration or workspace removal without permission.
- Don't modify another agent's workspace/revisions without coordination; don't check out its active revision.
- Run jj from your own workspace. Protect shared test/build resources.

## Messages

Repo conventions first. Otherwise: specific imperative subject, ≤70 characters, no trailing punctuation. Body explains motivation absent from diff. Style: `prose.md`.
