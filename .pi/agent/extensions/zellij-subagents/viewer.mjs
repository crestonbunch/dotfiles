#!/usr/bin/env node
// Read-only, bounded renderer. Never execute the child's command or interpret its output as terminal controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validRunDirectory, selectStep } from './core.mjs';
export { selectStep } from './core.mjs';

const MAX_STATUS = 512 * 1024;
const MAX_TAIL = 12 * 1024;
export function safeText(text) {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
async function tail(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) return '(output is not a regular file)';
    const handle = await fs.open(file, 'r');
    try {
      const length = Math.min(stat.size, MAX_TAIL);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, stat.size - length);
      return `${stat.size > length ? '(showing last 12 KiB)\n' : ''}${safeText(buf.subarray(0, bytesRead).toString('utf8'))}`;
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code === 'ENOENT') return '(waiting for output artifact)';
    return '(output unavailable)';
  }
}
export async function render(runDir, childId, index) {
  try {
    const stat = await fs.lstat(path.join(runDir, 'status.json'));
    if (!stat.isFile() || stat.size > MAX_STATUS) return 'Status artifact unavailable or too large';
    const status = JSON.parse(await fs.readFile(path.join(runDir, 'status.json'), 'utf8'));
    if (status.runId !== path.basename(runDir)) return 'Status run identity mismatch';
    const found = selectStep(status, childId, index);
    if (!found) return `Child ${safeText(childId)}: waiting for status artifact`;
    const { step, index: stepIndex } = found;
    const file = path.join(runDir, `output-${stepIndex}.log`);
    const header = `${safeText(String(step.label ?? step.agent ?? childId)).slice(0, 120)} · ${safeText(String(step.status ?? status.state ?? 'pending')).slice(0, 32)}\nRun ${status.runId} · child ${safeText(childId)}\nCtrl-C exits this viewer only. Clear finished panes from Pi or close the tab; Pi controls the child.\n\n`;
    return header + await tail(file);
  } catch (error) {
    return error?.code === 'ENOENT' ? 'Waiting for status artifact' : 'Status artifact temporarily unavailable';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  const dir = value('--run-dir');
  const childId = value('--child-id');
  const index = value('--index') === undefined ? undefined : Number(value('--index'));
  if (!args.includes('--idle') && (!validRunDirectory(dir, path.basename(dir ?? '')) || !childId || childId.length > 160)) {
    console.error('Invalid viewer arguments');
    process.exitCode = 2;
  } else {
    let alive = true;
    let feed;
    let paging = false;
    const stop = () => { alive = false; feed?.stop(); };
    // fzf owns keyboard input; the idle/raw viewer alone handles Ctrl+C.
    process.on('SIGINT', () => { if (!paging) stop(); });
    process.on('SIGTERM', stop);
    process.on('SIGHUP', stop);
    let last = '';
    let failedFile;
    const { sessionFileFor, startTranscript } = await import('./transcript.mjs');
    while (alive) {
      const file = args.includes('--idle') ? undefined : await sessionFileFor(dir, childId, index);
      if (!file) failedFile = undefined;
      if (file && file !== failedFile) {
        paging = true;
        feed = startTranscript(file, { runDir: dir, childId, index });
        const reason = await feed.done;
        feed = undefined;
        paging = false;
        if (reason === 'pager' || !alive) break; // q closes only this pane's viewer, never the child
        failedFile = file; // unavailable feed: use raw fallback, not a flashing retry loop
        last = '';
      }
      const next = args.includes('--idle') ? 'No active async children. Waiting for Pi…\nCtrl-C exits this viewer only.' : await render(dir, childId, index);
      if (next !== last) { process.stdout.write(`\x1b[H\x1b[2J${next}\n`); last = next; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
