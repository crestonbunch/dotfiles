import { createMcpExtension, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// SDK children do not supply the builtin:mcp factory without per-server selectors.
// Keep this outside auto-discovered extensions; only explorer loads it explicitly.
export default (pi: ExtensionAPI): void => {
  createMcpExtension()(pi);
  pi.on("session_start", () => {
    // These builtins are registered but not all active by default. Do not use a
    // tools allowlist: it would also discard dynamically registered MCP tools.
    pi.setActiveTools([...new Set([...pi.getActiveTools(), "read", "grep", "find", "ls", "codemode"])]);
  });
};
