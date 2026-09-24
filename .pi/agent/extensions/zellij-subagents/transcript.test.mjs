import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn as spawnReal } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sessionFileFor, startTranscript } from './transcript.mjs';
import { entries, row, preview, scan } from './events.mjs';
import { Readable } from 'node:stream';

const fixture = [
  { type: 'session', version: 3 },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'PRIVATE PROMPT' }] } },
  { type: 'message', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'HIDDEN REASONING' },
    { type: 'text', text: 'Visible answer\n\u001b[31mred\u001b[0m' },
    { type: 'toolCall', name: 'bash', arguments: { command: 'TOKEN=hunter2 echo hello', credentials: 'PRIVATE PASSWORD' } },
  ] } },
  { type: 'message', message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'result output' }, { type: 'image', data: 'PRIVATE IMAGE' }], details: { secret: 'PRIVATE DETAIL' }, isError: true } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(15000) }] } },
  { type: 'custom_message', content: 'PRIVATE EXTENSION' },
].map(x => JSON.stringify(x)).join('\n') + '\n{partial broken json\n';

test('status step sessionFile is late-bound and limited to a real regular child file below parent session stem', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-transcript-'));
  try {
    const dir = path.join(tmp, 'run1');
    const parent = path.join(tmp, 'parent.jsonl');
    const file = path.join(tmp, 'parent', 'child', 'run-0', 'session.jsonl');
    await fs.mkdir(dir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const status = { runId: 'run1', sessionId: parent, steps: [{ workflowKey: 'first', status: 'running' }, { workflowKey: 'second', status: 'running', sessionFile: file }] };
    const writeStatus = () => fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(status));
    await writeStatus();
    assert.equal(await sessionFileFor(dir, 'second', 1), undefined); // not yet created
    await fs.writeFile(file, '{}\n');
    assert.equal(await sessionFileFor(dir, 'second', 1), file);
    assert.equal(await sessionFileFor(dir, 'first', 0), undefined);
    const linked = path.join(tmp, 'parent', 'alias', 'run-0', 'session.jsonl');
    await fs.symlink(path.join(tmp, 'parent', 'child'), path.join(tmp, 'parent', 'alias'));
    status.steps[1].sessionFile = linked;
    await writeStatus();
    assert.equal(await sessionFileFor(dir, 'second', 1), undefined);
    status.steps[1].sessionFile = file;
    await writeStatus();
    status.steps[1].sessionFile = path.join(tmp, 'other', 'session.jsonl');
    await writeStatus();
    assert.equal(await sessionFileFor(dir, 'second', 1), undefined);
    status.steps[1].sessionFile = file;
    await writeStatus();
    await fs.rename(file, `${file}.real`);
    await fs.symlink(`${file}.real`, file);
    assert.equal(await sessionFileFor(dir, 'second', 1), undefined);
    status.runId = 'wrong';
    await writeStatus();
    assert.equal(await sessionFileFor(dir, 'second', 1), undefined);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('CLI viewer loads transcript without a top-level-await import cycle', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-viewer-cli-'));
  try {
    const dir = path.join(tmp, 'run1');
    const file = path.join(tmp, 'parent', 'child', 'run-0', 'session.jsonl');
    await fs.mkdir(dir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, fixture);
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', sessionId: path.join(tmp, 'parent.jsonl'), steps: [{ workflowKey: 'demo', status: 'running', sessionFile: file }] }));
    const viewer = fileURLToPath(new URL('./viewer.mjs', import.meta.url));
    const child = spawnReal(process.execPath, [viewer, '--run-dir', dir, '--child-id', 'demo'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill('SIGTERM'), 500);
    const code = await new Promise(resolve => child.once('close', resolve));
    clearTimeout(timer);
    assert.notEqual(code, 13, stderr);
    assert.doesNotMatch(stderr, /unsettled top-level await/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('event list and preview exclude prompts/thinking and bound, sanitize and select detail', async () => {
  const rows = [];
  await scan(Readable.from([fixture]), (line, _number, offset) => {
    entries(line).forEach((event, part) => rows.push(row(`${offset}:${part}`, event)));
  });
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^\d+:0\tassistant: Visible answer red/);
  assert.match(rows[1], /tool bash/);
  assert.match(rows[2], /error bash/);
  assert.ok(rows.every(value => value.length < 230));
  for (const secret of ['PRIVATE PROMPT', 'PRIVATE PASSWORD', 'PRIVATE IMAGE', 'PRIVATE DETAIL', 'PRIVATE EXTENSION', 'HIDDEN REASONING', 'hunter2', '\u001b']) assert.ok(!rows.join('\n').includes(secret), secret);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-event-test-'));
  try {
    const file = path.join(tmp, 'session.jsonl');
    await fs.writeFile(file, fixture);
    const firstId = rows[0].split('\t')[0];
    const toolId = rows[1].split('\t')[0];
    const lastId = rows[3].split('\t')[0];
    assert.match(await preview(file, firstId), /Visible answer red/);
    assert.match(await preview(file, toolId), /token=\[redacted\]/i);
    assert.match(await preview(file, lastId), /\[truncated\]/);
    assert.ok((await preview(file, lastId)).length < 12400);
    assert.equal(await preview(file, `${firstId};echo hacked`), '(invalid selection)');
    const scanned = [];
    await scan(Readable.from([`${'x'.repeat(300000)}\n`, fixture]), (line, number) => scanned.push(number));
    assert.equal(scanned[0], 2); // oversized untrusted JSONL line is skipped
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('preview seeks to late events without scanning a large transcript prefix', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-event-offset-'));
  try {
    const file = path.join(tmp, 'session.jsonl');
    const prefix = `${'x'.repeat(3 * 1024 * 1024)}\n`;
    const last = `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'late event' }] } })}\n`;
    await fs.writeFile(file, prefix + last);
    const rows = [];
    await scan(Readable.from([Buffer.from(prefix.slice(0, 17)), Buffer.from(prefix.slice(17) + last)]), (line, _number, offset) => {
      entries(line).forEach((event, part) => rows.push(row(`${offset}:${part}`, event)));
    });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].split(':')[0]), Buffer.byteLength(prefix));
    assert.match(await preview(file, rows[0].split('\t')[0]), /late event/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('pane wrapper invokes live tail/Node/fzf directly; exit cleans up feed without attaching Pi', async () => {
  const calls = [];
  function spawnProcess(command, args, options) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = signal => { child.killed = true; child.signal = signal; child.emit('exit', null, signal); };
    calls.push({ command, args, options, child });
    return child;
  }
  const feed = startTranscript('/safe path/session.jsonl', { runDir: '/safe path/run', childId: 'child', index: 0, spawnProcess });
  assert.deepEqual(calls.map(c => c.command), ['fzf', process.execPath, 'tail']);
  assert.ok(calls[0].args.includes('--tac'));
  assert.ok(calls[0].args.includes('--preview'));
  assert.match(calls[0].args[calls[0].args.indexOf('--preview') + 1], /--preview \{1\}$/);
  assert.deepEqual(calls[2].args, ['-n', '+1', '-f', '/safe path/session.jsonl']);
  assert.equal(calls[0].options.env.ZELLIJ_CHILD_RUN_DIR, '/safe path/run');
  assert.equal(calls[0].options.env.ZELLIJ_CHILD_ID, 'child');
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[2].options.detached, true);
  calls[0].child.emit('exit', 0);
  assert.equal(await feed.done, 'pager');
  assert.ok(calls.slice(1).every(c => c.child.killed));
  feed.stop(); // idempotent
});
