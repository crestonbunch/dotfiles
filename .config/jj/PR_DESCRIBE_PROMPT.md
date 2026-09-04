Draft a GitHub PR body. Follow supplied prose/PR rules; global context may be disabled.

## Context

- `Prose rules`, `Pull request rules`: applicable instructions.
- `Repository`: root and requested revision range.
- `GitHub PR template`: discovered template, if present.
- `Commits`: PR-range descriptions; primary motivation source.
- `Recent history`: bounded background, possibly outside PR. Don't attribute unrelated changes to this PR.
- `Diff`: authoritative change scope. Truncated? Read supplied full-diff file in chunks before drafting.

## Investigation

Use available read-only file tools: changed files/callers, ticket references,
templates in root/`.github/`/`docs/` (including template directories). Choose the
appropriate template. Current checkout may differ from PR revisions.

Pi has file tools, no shell/GitHub commands. Use supplied history; don't invent
unavailable PR/issue contents. Other backends: use available read-only history
or GitHub tools only when context is insufficient.

Stay focused. No evidenced motivation? Describe the effect; don't invent a reason.

## Verification

Tests added ≠ tests executed. Claim execution/pass results only with supporting
evidence. Don't infer success from test code or a proposed check.

## Output

Markdown body only. No preamble, commentary, enclosing fence, or repeated PR title.
