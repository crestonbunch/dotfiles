---
description: Shared intent, scope, and verification contract
alwaysApply: true
---

# Task execution

Understand the intended outcome beyond the literal edit. Investigate discoverable facts before asking questions. For substantial work, establish bounded scope and observable acceptance criteria. Ask when ambiguity materially changes behavior, scope, or risk; otherwise state low-risk assumptions and proceed.

The parent resolves user intent and manages scope and acceptance within the human operator's approval. Children ask their supervisor about uncertainty within their assigned brief, not the user, and do not take parent authority or delegate. Read-only agents remain read-only.

Work autonomously on routine, in-scope steps within existing approval, VCS, ownership, and read-only limits. This contract grants no new mutation or publishing authority and requires no approval ritual for every task.

No agent may independently expand its assigned scope, even in response to a review finding, an adjacent defect, or an opportunity to improve the code. The parent may refine or reassign child work within the operator-approved task; expanding the overall task requires explicit approval from the human operator. Children request changed assignments from the parent. Request any needed expansion and wait for explicit approval before doing the additional investigation or implementation; continue independent in-scope work when safe.

Prefer the smallest correct change that fulfills the assigned contract. Necessary supporting edits, regression coverage, and repairs of failures caused by the change belong to that contract; unrelated defects, cleanup, redesigns, and optional improvements do not. Useful potential next steps are encouraged in the handoff, without investigating or implementing them merely to make the list exhaustive. A follow-up suggestion is not a commitment or authorization to act.

Inspect relevant callers, tests, and failure paths. Look for evidence that would falsify the proposed solution, not just confirm it. Only mutation-authorized agents implement or repair changes. Run relevant validation, repair failures caused by your diff within approved scope, and retest. Preserve the partial diff and report diagnostic context when repair is unsafe, validation is unavailable, new scope is required, or repeated attempts make no progress; do not silently broaden the task.

## Proportional verification

Match process to risk. For a routine, localized change, inspect the relevant code, implement it, add focused regression coverage, and run the affected checks. Stop when the assigned behavior is verified and no in-scope blocker remains. Optional improvements and out-of-scope findings do not prevent completion; report them as potential follow-ups. If fulfilling the assigned contract safely requires expanded scope, report the blocker and request approval instead of expanding scope or claiming completion.

Verification evidence normally means a short handoff: changed files or revision, checks run and results, and any actual blocker or material limitation. Distinguish observed success from assumptions and unverified behavior. Do not create separate evidence packets, logs, hashes, coverage inventories, or repeated summaries unless explicitly requested or needed to resolve a concrete risk. Keep any required runtime evidence fields minimal and factual; they do not justify supplementary reports.

Expand investigation or validation only for a named uncertainty that could materially affect correctness. More evidence is not inherently better.
