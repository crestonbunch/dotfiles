import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectStep } from './core.mjs';

const helper = fileURLToPath(new URL('./events.mjs', import.meta.url));
// Static paths are shell-quoted for fzf's preview shell; selected IDs are generated
// as digits/colon only and fzf quotes its placeholder. Session paths stay in env.
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const MAX_STATUS = 512 * 1024;

// The status artifact identifies a step; it does not grant permission to read
// arbitrary paths. Child sessions live under the parent session's stem directory.
export async function sessionFileFor(runDir, childId, index) {
  try {
    const statusPath = path.join(runDir, 'status.json');
    const stat = await fs.lstat(statusPath);
    if (!stat.isFile() || stat.size > MAX_STATUS) return undefined;
    const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
    if (status.runId !== path.basename(runDir)) return undefined;
    const file = selectStep(status, childId, index)?.step?.sessionFile;
    const parent = status.sessionId;
    if (typeof parent !== 'string' || !path.isAbsolute(parent) || !parent.endsWith('.jsonl') ||
        typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('/session.jsonl')) return undefined;
    const root = parent.slice(0, -'.jsonl'.length);
    if (path.normalize(file) !== file || !file.startsWith(`${root}${path.sep}`)) return undefined;
    // Resolve the trusted stem once (macOS /var may alias /private/var), but
    // reject symlinks in the child-relative portion and at the child file.
    if (!(await fs.lstat(root)).isDirectory() || !(await fs.lstat(file)).isFile()) return undefined;
    if (await fs.realpath(file) !== path.join(await fs.realpath(root), path.relative(root, file))) return undefined;
    return file;
  } catch { return undefined; } // status may be incomplete while the child starts
}

// fzf consumes a live stream and renders detail only for the highlighted event.
// No user-controlled data is interpolated into a shell command: preview gets only
// a generated numeric ID, and the helper revalidates the session path on each call.
export function startTranscript(file, { runDir, childId, index, spawnProcess = spawn } = {}) {
  const children = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const child of children) {
      child.stdout?.unpipe();
      child.stdin?.destroy();
      if (!child.killed) child.kill('SIGTERM');
    }
  };
  try {
    const env = { ...process.env, ZELLIJ_CHILD_RUN_DIR: runDir, ZELLIJ_CHILD_ID: childId,
      ZELLIJ_CHILD_INDEX: index === undefined ? '' : String(index), FZF_DEFAULT_OPTS: '' };
    const finder = spawnProcess('fzf', ['--tac', '--no-sort', '--tail=10000', '--disabled', '--delimiter=\t', '--with-nth=2', '--nth=2',
      '--layout=reverse', '--preview-window=down:60%:wrap', '--preview', `${quote(process.execPath)} ${quote(helper)} --preview {1}`,
      '--bind', 'j:down,k:up,ctrl-j:preview-down,ctrl-k:preview-up,alt-j:preview-down,alt-k:preview-up',
      '--bind', '/:enable-search+unbind(j,k)+change-prompt(Search> ),ctrl-g:disable-search+rebind(j,k)+change-query()+change-prompt(Events> )',
      '--prompt', 'Events> ', '--header', '↑↓/j/k select · / search (Ctrl-G back) · Ctrl-J/K scroll detail · Esc/Ctrl-C exit',
      '--bind', 'ctrl-c:abort'], { stdio: ['pipe', 'inherit', 'inherit'], env });
    children.push(finder);
    const list = spawnProcess(process.execPath, [helper, '--list'], { stdio: ['pipe', 'pipe', 'ignore'], env });
    children.push(list);
    const tail = spawnProcess('tail', ['-n', '+1', '-f', file], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    children.push(tail);
    tail.stdout.pipe(list.stdin);
    list.stdout.pipe(finder.stdin);
    for (const child of children) child.stdin?.on('error', () => {});
    const done = new Promise(resolve => {
      finder.once('exit', () => { stop(); resolve('pager'); });
      finder.once('error', () => { stop(); resolve('feed'); });
      for (const child of [tail, list]) {
        child.once('error', () => { stop(); resolve('feed'); });
        child.once('exit', () => { if (!stopped) { stop(); resolve('feed'); } });
      }
    });
    return { stop, done };
  } catch {
    stop();
    return { stop, done: Promise.resolve('feed') };
  }
}
