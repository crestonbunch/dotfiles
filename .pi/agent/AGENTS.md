## Subagent routing

As the parent orchestrator, use subagents by default for work beyond a single small change. Large: explorer → advisor → builder(s) → integrate task workspaces → reviewer. Typical: explorer → worker/builder → reviewer. Do a small, fast change yourself; split batches of small changes when useful and review significant results. Start children with fresh, task-specific context. This is standing authorization for the parent to delegate; follow `/Users/creston/.agents/rules/personal/preferences.md` for role boundaries and workspace safety. If the subagent tool is unavailable, say so rather than silently substituting direct work.

Personal `alwaysApply` rules are injected by `personal-rules.ts`. For PR titles or bodies, read `/Users/creston/.agents/rules/personal/pull-requests.md`.
