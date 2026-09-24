---
description: VCS ownership, history edits, and jj workspaces
alwaysApply: true
---

# jj / VCS

- Prefer jj in jj workspaces; otherwise use the repo's VCS. Before edits, check status and revision. Separate work from another agent's active revision.
- Keep related task changes in one cohesive revision. Commit completed steps with a descriptive message; leave only the fresh empty working-copy revision undescribed. Never commit an empty revision or unrelated changes.
- **Owned** means assigned to this task, not merely current/unpublished. Rewrite only owned, unpublished history after checking descendants and workspace ownership. Ask before changing shared/published history, discarding user work, or force-pushing; ask if ownership is unclear.
- Git-only: do not commit unless requested. Bookmarks and PR creation require permission. For read-only jj review, `--ignore-working-copy` avoids snapshotting concurrent work.

## Workspaces

- One writer per workspace. Parallel writers use separate jj workspaces under `~/.workspaces/`, based on recorded revisions; coordinate overlapping files and shared test resources. Run jj from your own workspace; never check out another agent's active revision.
- Await integration authorization. Integrate each task workspace serially, verify the combined result, then forget integrated workspaces and abandon task-owned empty revisions. Verify intended changes are preserved and no active workspace uses those revisions. Do not leave empty integration commits. Forgetting does not authorize deleting directories or unrelated workspaces.

## Messages

Commit as the configured user only. Never override identity or add agent/co-author attribution. Follow repo conventions; otherwise use an imperative subject ≤70 characters without trailing punctuation. Explain motivation in the body when the diff does not.
