# pi-subagents Zellij companion

A standalone terminal dashboard for async `pi-subagents` runs. Pi remains the runner and lifecycle authority. The companion uses only the public, process-local `subagents:rpc:v1:*` event contract and exposes a narrow session-bound bridge over a private Unix socket.

## Use

The package is registered as a local package in `~/.pi/agent/settings.json`.

1. Start Pi inside Zellij.
2. Run `/reload` after installing or changing the package.
3. Press `Ctrl+Alt+Z`, or run `/subagents-zellij` if the terminal intercepts the shortcut.
4. Use `↑`/`↓` or `j`/`k` to choose a run or child, `r` to refresh, and `s` to compose guidance. In the composer, `Tab` cycles `steer`, `follow_up`, and `auto`; `Enter` sends; `Esc` cancels.
5. Press `q` to close only the dashboard pane. This never stops agents.

The Pi footer shows this companion's own `Ctrl+Alt+Z dashboard` hint. The built-in Fleet and Herdr UI and bindings are unchanged.

The dashboard shows async runs, child state, live transcript tails, and package-issued steering receipts (`delivered`, `queued`, or an error). Selecting a run means all eligible children. A multi-child run requires an explicit broadcast confirmation. Selecting one child never silently falls back to run-level broadcast. Guidance stays bound to the target selected when the composer opened; a changed or unavailable target cancels submission. Repeated confirmation cannot submit concurrent copies.

## Lifecycle and failures

The bridge starts only for a TUI session inside Zellij. It does not start in print, JSON, RPC, or headless child modes. `/reload` replaces the bridge at the same session-scoped socket, allowing an existing viewer to reconnect. Switching sessions uses a different private socket and pane identity. Parent exit disconnects the viewer and does not affect detached children.

The socket directory is user-owned mode `0700`; the socket and session token are mode `0600`. Requests, replies, time, transcript lines, message size, connections, methods, and parameters are bounded. The bridge accepts only status/transcript and steer operations. It cannot spawn, stop, resume, interrupt, write sessions, select cwd/files, or invoke arbitrary RPC methods.

Requests allow up to 5 seconds per public RPC, 16 seconds per bridge operation, and 18 seconds at the viewer. Disconnecting cancels pending ownership checks so they cannot dispatch steering later. Once steering has been dispatched, losing its receipt cannot undo it: the UI reports delivery as unknown and asks you to inspect the run before resending.

Outside Zellij, or when the public RPC owner is unavailable, the command reports a useful error and does not switch to another execution or inspection mode. `/subagents-inspect-rpc` is not used because it is unavailable as a TUI transport.

## Public API limitation

`pi-subagents` 0.65.1 exposes real top-level run IDs in `asyncSnapshot`, but it does not expose a structured mapping from every async child identity to the numeric `index` required by public `steer` and transcript requests. This companion enables child-specific targeting only for an exact public `step:<n>` identity and revalidates that identity, active state, run ownership, and rich target status immediately before the operation. Workflow keys, child run IDs, visual row positions, formatted text, truncation, and singleton guesses are never converted to indices. Other children remain visible and are labeled `view only`; use the separately labeled run-level transcript or explicitly confirmed run-level guidance.

A useful upstream improvement would add a bounded structured child target `{ childId, index }` to targeted public status, or allow public transcript/steer requests to accept canonical `childId` directly.

## Limits

- Async runs only. Foreground runs are not moved into panes.
- No stop, resume, spawn, replacement execution, session mutation, control-file writing, or worktree orchestration.
- The picker reflects the bounded public status snapshot. Omission counts remain visible through run availability but cannot be expanded by this v1 UI.
- Interactive pane creation/focus and real steering need manual verification in a live Pi/Zellij session with an existing async run.

## Tests

```sh
cd ~/.pi/packages/pi-subagents-zellij
npm test
```
