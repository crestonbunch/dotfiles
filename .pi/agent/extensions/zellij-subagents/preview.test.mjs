import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRenderer } from './preview.mjs';
import { preview } from './events.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageDir = process.env.PI_PACKAGE_DIR;
const withoutStyle = text => text.replace(/\x1b\[[0-9;:]*m/g, '');

test('preview preserves raw text and identifies a formatting failure', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-preview-failure-'));
  try {
    const file = path.join(tmp, 'session.jsonl');
    await fs.writeFile(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'source\n    indented' }] } }) + '\n');
    const result = await preview(file, '0:0', { raw: false, renderer() { throw new Error('broken\n\x1b[2Jformatter'); } });
    assert.equal(result, 'assistant\n\n(formatting unavailable: broken formatter)\n\nsource\n    indented');
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('preview CLI supports rendered and raw text and recovers from unavailable formatting', { skip: !packageDir && 'set PI_PACKAGE_DIR to the installed Pi package root' }, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-preview-cli-'));
  try {
    const run = path.join(tmp, 'run1');
    const file = path.join(tmp, 'parent', 'child', 'session.jsonl');
    await fs.mkdir(run);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: '# Header\n\n**bold** and [link](https://example.com)' }] } }) + '\n');
    await fs.writeFile(path.join(run, 'status.json'), JSON.stringify({ runId: 'run1', sessionId: path.join(tmp, 'parent.jsonl'), steps: [{ workflowKey: 'child', sessionFile: file }] }));
    const env = { ...process.env, ZELLIJ_CHILD_RUN_DIR: run, ZELLIJ_CHILD_ID: 'child', ZELLIJ_CHILD_INDEX: '', ZELLIJ_PI_PACKAGE: packageDir, FZF_PREVIEW_LABEL: 'Rendered', FZF_PREVIEW_COLUMNS: '80', FORCE_COLOR: '1' };
    const helper = fileURLToPath(new URL('./events.mjs', import.meta.url));
    const rendered = spawnSync(process.execPath, [helper, '--preview', '0:0'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /\x1b\[/);
    assert.match(withoutStyle(rendered.stdout), /bold and link/);
    assert.doesNotMatch(rendered.stdout, /formatting unavailable|entry unavailable|\x1b\]/);
    const raw = spawnSync(process.execPath, [helper, '--preview', '0:0'], { env: { ...env, FZF_PREVIEW_LABEL: 'Raw' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(raw.status, 0, raw.stderr);
    assert.match(raw.stdout, /# Header\n\n\*\*bold\*\*/);
    assert.doesNotMatch(raw.stdout, /\x1b/);
    const unavailable = spawnSync(process.execPath, [helper, '--preview', '0:0'], { env: { ...env, ZELLIJ_PI_PACKAGE: '' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.match(unavailable.stdout, /formatting unavailable: reopen this tab after \/reload/);
    assert.match(unavailable.stdout, /# Header\n\n\*\*bold\*\*/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('Pi renders Markdown and highlighted code without forwarding terminal controls', { skip: !packageDir && 'set PI_PACKAGE_DIR to the installed Pi package root' }, async () => {
  const renderer = await loadRenderer(packageDir);
  const markdown = renderer({ format: 'markdown', detail: '# Heading\n\n**bold** and [link](https://example.com)\n\n```rust\nfn main() {}\n```' }, 80);
  assert.doesNotMatch(markdown, /formatting unavailable/);
  assert.match(markdown, /\x1b\[/);
  assert.match(withoutStyle(markdown), /Heading/);
  assert.match(withoutStyle(markdown), /bold and link/);
  assert.match(withoutStyle(markdown), /fn main\(\)/);
  assert.doesNotMatch(markdown, /\x1b\]/);
  const source = renderer({ path: 'main.rs', detail: 'fn main() {\n\tlet x = 1;\n}' }, 80);
  assert.match(source, /\x1b\[/);
  assert.equal(withoutStyle(source), 'fn main() {\n    let x = 1;\n}');
});

test('Pi keeps logs plain and colors commands and diffs', { skip: !packageDir && 'set PI_PACKAGE_DIR to the installed Pi package root' }, async () => {
  const renderer = await loadRenderer(packageDir);
  assert.equal(renderer({ detail: '# build log\n\n**not Markdown**' }, 80), '# build log\n\n**not Markdown**');
  assert.match(renderer({ language: 'bash', detail: 'echo "$HOME"' }, 80), /\x1b\[/);
  const diff = renderer({ detail: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new' }, 80);
  assert.match(diff, /\x1b\[/);
  assert.match(withoutStyle(diff), /-old\n\+new/);
});
