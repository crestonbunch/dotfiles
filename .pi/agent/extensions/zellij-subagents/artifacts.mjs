import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validRunDirectory } from './core.mjs';

// The documented async-subagent-runs/<id>/status.json hierarchy, not a private package import.
// Verify the exact session/run identity; do not truncate temp roots or reload can miss live runs.
export async function findRunDir(runId, sessionIds, hint, tmp = os.tmpdir()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId) || !sessionIds?.length) return undefined;
  const roots = [];
  if (validRunDirectory(hint, runId)) roots.push(hint);
  try {
    const entries = await fs.readdir(tmp, { withFileTypes: true });
    for (const entry of entries.filter(e => e.name.startsWith('pi-subagents-') && e.isDirectory())) {
      roots.push(path.join(tmp, entry.name, 'async-subagent-runs', runId));
    }
  } catch { /* unavailable tmpdir */ }
  for (const dir of roots) {
    try {
      // Refuse symlinked run/status paths; the parent directory is from the OS tmpdir listing.
      if (!(await fs.lstat(dir)).isDirectory()) continue;
      const statusPath = path.join(dir, 'status.json');
      const stat = await fs.lstat(statusPath);
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
      if (status.runId === runId && sessionIds.includes(status.sessionId)) return dir;
    } catch { /* run is not yet durable, or no longer exists */ }
  }
  return undefined;
}
