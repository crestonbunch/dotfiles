## Subagent routing

As the parent orchestrator, use subagents by default for work beyond a single small change. Large: explorer → advisor → builder(s) → integrate task workspaces → reviewer. Typical: explorer → worker/builder → reviewer. Do a small, fast change yourself; split batches of small changes when useful and review significant results. Start children with fresh, task-specific context. This is standing authorization for the parent to delegate; follow `/Users/creston/.agents/rules/personal/preferences.md` for role boundaries and workspace safety. If the subagent tool is unavailable, say so rather than silently substituting direct work.

## Personal preferences

Read and apply these shared personal rules:

- `/Users/creston/.agents/rules/personal/preferences.md`
- `/Users/creston/.agents/rules/personal/prose.md`
- `/Users/creston/.agents/rules/personal/jj.md`
- `/Users/creston/.agents/rules/personal/comments.md`
- `/Users/creston/.agents/rules/personal/testing.md`
- `/Users/creston/.agents/rules/personal/error-handling.md`
- `/Users/creston/.agents/rules/personal/module-design.md`

When writing a pull request title or body, also read and apply
`/Users/creston/.agents/rules/personal/pull-requests.md`.
