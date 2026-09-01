---
name: compact-revision-log
description: Compress the Claude conversation log for the current jj revision by filtering out noise while preserving decisions and user intent. Use from any agent when the user says "compact the log", "clean up the revision log", or "compress the log".
---

# Compact the revision log

The Claude hook system maintains an append-only conversation log per jj
revision at `~/.local/share/claude-logs/<project>/<change-id>.md`. Over a
long session these files accumulate noise — inline diffs, code blocks,
repeated context, verbose tool output — that bloats the file and degrades
its usefulness as commit-message context for `jj cc` / `jj cd`.

## Steps

1. Determine the log file path:

```bash
ws_root=$(jj workspace root)
ws_name=$(basename "$ws_root")
ws_hash=$(printf '%s' "$ws_root" | shasum | cut -c1-8)
rev_id=$(jj log --no-graph -r @ -T 'change_id')
log_file="$HOME/.local/share/claude-logs/${ws_name}-${ws_hash}/${rev_id}.md"
```

2. Read the log file. If it doesn't exist or is empty, tell the user and
   stop.

3. Filter the full contents with these requirements:

> Filter this conversation log to remove noise. Keep the structure
> (timestamps, `## User` / `## Changes` headers) intact.
>
> REMOVE:
> - Code diffs, unified diffs, patch fragments
> - Inline code blocks longer than 3 lines
> - Raw tool output, file listings, directory trees
> - Redundant or repeated information (keep the first/best occurrence)
>
> KEEP AS-IS (do not summarize or rephrase):
> - User messages and requests
> - Decisions, choices, and their rationale
> - Names of files, functions, and tools mentioned in discussion
> - Tradeoffs, constraints, and rejected alternatives
> - Error messages that led to a change in approach
>
> Output the filtered log and nothing else. No preamble, no commentary.

4. Write the filtered output back to the same file, replacing the
   original.

5. Report the before/after size to the user.
