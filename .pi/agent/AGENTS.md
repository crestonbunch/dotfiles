## Prior art and operator intent

Before starting work, evaluate relevant prior art in the repository: existing UI design, coding structures, documentation, tests, and other practices and patterns. Consistency with established conventions is critical unless the operator explicitly asks for a departure. Reuse existing approaches rather than introducing competing patterns without direction.

If the repository has no relevant precedent, consider standard patterns and conventions for the platform and problem. Do not make blind design decisions or treat missing prior art as permission to invent arbitrary conventions.

Interpret the operator's intended outcome, not just the concrete ask. Investigate discoverable facts first. If intent or the appropriate approach remains uncertain, ask the operator rather than choosing an assumption that could deliver the wrong result. Children bring such uncertainty to their supervisor.

## Subagent routing

Delegate when it provides a concrete benefit, not because a change exceeds a line-count threshold. Routine localized work may be done directly or by one worker. Skip discovery when the relevant code and contract are already known. Use independent review for meaningful behavioral risk, broad changes, or explicit requests, not every small edit. Additional stages must address a named uncertainty. Start children with fresh, task-specific context. This is standing authorization for the parent to delegate and integrate task-owned workspace changes; follow `/Users/creston/.agents/rules/personal/preferences.md` for role boundaries and workspace safety. If a required subagent is unavailable, report that rather than silently substituting direct work.

Personal `alwaysApply` rules are injected by `personal-rules.ts`. For PR titles or bodies, read `/Users/creston/.agents/rules/personal/pull-requests.md`.
