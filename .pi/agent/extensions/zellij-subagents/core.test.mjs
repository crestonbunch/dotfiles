import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activeChildren, ZellijView } from './core.mjs';
import { findRunDir } from './artifacts.mjs';
import { render, safeText, selectStep } from './viewer.mjs';

const snapshot = runs => ({ kind: 'pi-subagents.async-status-snapshot', version: 1, runs, omitted: { runs: 0, children: 0, byteLimitExceeded: false } });
const root = (id, children) => ({ id, kind: 'workflow', state: 'running', label: 'workflow', children });
const step = (id, state = 'running') => ({ id, kind: 'step', state, label: id });

test('active async child projections exclude host steps, terminal children, inactive roots and reject truncation', () => {
  assert.deepEqual(activeChildren(snapshot([root('r', [step('alpha'), step('done', 'complete'), { id: 'host', kind: 'host-step', state: 'running', label: 'host' }]), { id: 'other', kind: 'subagent', state: 'complete', label: 'other' }])), [{ key: 'r:r:alpha', rootId: 'r', id: 'alpha', label: 'alpha', index: undefined }]);
  assert.equal(activeChildren(snapshot([{ id: 'a', kind: 'subagent', label: 'agent', state: 'running' }])).length, 1);
  assert.throws(() => activeChildren({ ...snapshot([]), omitted: { runs: 1 } }), /truncated/);
});

test('artifact discovery is session/run scoped and refuses symlinked status', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-subagents-test-'));
  try {
    const dir = path.join(tmp, 'pi-subagents-test', 'async-subagent-runs', 'run1');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', sessionId: 'other' }));
    assert.equal(await findRunDir('run1', ['mine'], undefined, tmp), undefined);
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', sessionId: 'mine' }));
    assert.equal(await findRunDir('run1', ['mine'], undefined, tmp), dir);
    await fs.rename(path.join(dir, 'status.json'), path.join(dir, 'real.json'));
    await fs.symlink(path.join(dir, 'real.json'), path.join(dir, 'status.json'));
    assert.equal(await findRunDir('run1', ['mine'], undefined, tmp), undefined);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('artifact discovery finds current-session runs beyond 32 temp roots', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-subagents-many-roots-'));
  try {
    for (let i = 0; i < 40; i++) {
      await fs.mkdir(path.join(tmp, `pi-subagents-${String(i).padStart(2, '0')}`));
    }
    const dir = path.join(tmp, 'pi-subagents-zz-current', 'async-subagent-runs', 'run1');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', sessionId: 'mine' }));
    assert.equal(await findRunDir('run1', ['mine'], undefined, tmp), dir);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('viewer selects named workflow child, bounds output and removes terminal controls', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zellij-subagents-viewer-'));
  const dir = path.join(tmp, 'run1');
  try {
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', state: 'running', steps: [{ agent: 'reviewer', workflowKey: 'review', status: 'running' }] }));
    await fs.writeFile(path.join(dir, 'output-0.log'), '\x1b[31mhello\x1b[0m\n');
    assert.equal(selectStep({ runId: 'run1', steps: [{ workflowKey: 'review' }] }, 'review')?.index, 0);
    assert.match(await render(dir, 'review'), /hello/);
    assert.doesNotMatch(await render(dir, 'review'), /\x1b/);
    assert.equal(safeText('\x1b]0;owned\x07test\x00'), 'test');
    assert.match(await render(dir, 'missing'), /waiting/);
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ runId: 'run1', state: 'complete', steps: [{ agent: 'reviewer', workflowKey: 'review', status: 'failed' }] }));
    await fs.writeFile(path.join(dir, 'output-0.log'), 'final failure details\n');
    const final = await render(dir, 'review');
    assert.match(final, /failed/);
    assert.match(final, /final failure details/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

function mockView() {
  const calls = [], tabs = [], panes = [];
  const states = new Map();
  let statusFails = false;
  let next = 1;
  async function cli(args) {
    calls.push(args);
    switch (args[0]) {
      case 'new-tab': tabs.push({ tab_id: 42, name: args[args.indexOf('--name') + 1], active: true }); panes.push({ id: 555, is_plugin: true, tab_id: 42 }); panes.push({ id: next++, is_plugin: false, tab_id: 42 }); return '42\n';
      case 'new-pane': { const id = next++; panes.push({ id, is_plugin: false, tab_id: 42 }); return `terminal_${id}\n`; }
      case 'list-tabs': return JSON.stringify(tabs);
      case 'list-panes': return JSON.stringify(panes);
      case 'close-pane': {
        const i = panes.findIndex(p => !p.is_plugin && `terminal_${p.id}` === args[2]);
        assert.ok(i >= 0, 'close only existing terminal panes');
        panes.splice(i, 1); return '';
      }
      default: return '';
    }
  }
  const readStatus = async () => {
    if (statusFails) throw new Error('status temporarily unavailable');
    return { runId: 'r', steps: [...states].map(([workflowKey, status]) => ({ workflowKey, status })) };
  };
  return { calls, tabs, panes, states, failStatus: value => { statusFails = value; }, v: new ZellijView({ cli, viewer: '/viewer.mjs', name: 'unique tab', readStatus }) };
}
const child = (id, rootId = 'r') => ({ key: `${rootId}:${id}`, rootId, id, label: `child ${id}`, index: 0 });
const dirs = new Map([['r', '/tmp/async-subagent-runs/r']]);

test('mock Zellij retains completed viewers, repeated refresh, clears only finished and verifies ownership', async () => {
  const { calls, tabs, panes, states, v } = mockView();
  states.set('one', 'running'); states.set('two', 'running');
  await v.open();
  await v.reconcile([child('one'), child('two')], dirs);
  assert.ok(calls.find(args => args[0] === 'new-tab').includes('--no-focus'));
  assert.ok(calls.filter(args => args[0] === 'new-pane').every(args => args.includes('--no-focus')));
  assert.equal(calls.filter(args => args[0] === 'go-to-tab-by-id').length, 0);
  await v.focus();
  assert.deepEqual(calls.at(-1), ['go-to-tab-by-id', '42']);
  const doneId = v.panes.get('r:one');
  states.set('one', 'complete');
  await v.reconcile([child('two')], dirs);
  assert.equal(v.finished.get('r:one'), doneId);
  assert.deepEqual(calls.find(args => args[0] === 'rename-pane'), ['rename-pane', '--pane-id', doneId, 'Finished · child one']);
  assert.equal(v.emptyPane, undefined);
  const before = calls.length;
  await v.reconcile([child('two')], dirs);
  assert.equal(calls.slice(before).filter(args => ['rename-pane', 'close-pane', 'new-pane'].includes(args[0])).length, 0);
  // A transient projection can show the same child again; reuse rather than duplicate its pane.
  await v.reconcile([child('one'), child('two')], dirs);
  assert.equal(v.panes.get('r:one'), doneId);
  assert.equal(v.finished.size, 0);
  await v.reconcile([child('two')], dirs);
  await v.clearCompleted();
  assert.equal(v.panes.size, 1);
  assert.equal(v.finished.size, 0);
  assert.ok(panes.some(p => `terminal_${p.id}` === v.panes.get('r:two')));
  assert.ok(!panes.some(p => `terminal_${p.id}` === doneId));
  states.set('two', 'failed');
  await v.reconcile([], new Map());
  assert.equal(v.finished.size, 1);
  assert.equal(v.emptyPane, undefined);
  await v.clearCompleted();
  assert.ok(v.emptyPane);
  panes.push({ id: 999, is_plugin: false, tab_id: 42 });
  await assert.rejects(v.clearCompleted(), /changed externally/);
  assert.equal(tabs.length, 1);
  assert.equal(panes.length, 3);
  await v.shutdown();
  assert.equal(tabs.length, 1); // reload leaves the previous tab to the user
});

test('view visibility is read-only and periodic reconciliation never stacks or focuses a tab', async () => {
  const { calls, tabs, states, v } = mockView();
  states.set('one', 'running'); states.set('two', 'running');
  await v.open();
  assert.equal(await v.visible(), true);
  tabs[0].active = false;
  assert.equal(await v.visible(), false);
  await v.reconcile([child('one'), child('two')], dirs);
  await v.reconcile([child('one'), child('two')], dirs);
  assert.ok(!calls.some(args => args[0] === 'stack-panes' || args[0] === 'go-to-tab-by-id'));
  tabs.length = 0; // user closes the tab; background reconciliation must not create another
  assert.equal(await v.owned(), false);
  await v.reconcile([child('one')], dirs);
  assert.equal(calls.filter(args => args[0] === 'new-tab').length, 1);
});

test('switching tabs mid-reconcile or clear prevents all subsequent layout mutations', async () => {
  const { calls, tabs, states, v } = mockView();
  states.set('one', 'running'); states.set('two', 'running');
  await v.open();
  const original = v.cli;
  let mutations = 0;
  v.cli = async args => {
    const result = await original(args);
    if (['new-pane', 'rename-pane', 'close-pane'].includes(args[0]) && ++mutations === 1) tabs[0].active = false;
    return result;
  };
  assert.equal(await v.reconcile([child('one'), child('two')], dirs), false);
  assert.equal(mutations, 1);
  assert.equal(v.panes.size, 1);
  tabs[0].active = true;
  await v.reconcile([child('one'), child('two')], dirs);
  states.set('one', 'complete'); states.set('two', 'complete');
  await v.reconcile([], new Map());
  assert.equal(v.finished.size, 2);
  mutations = 0;
  assert.equal(await v.clearCompleted(), false);
  assert.equal(mutations, 1);
  assert.equal(v.finished.size, 1);
  assert.equal(tabs[0].active, false);
  const before = calls.filter(args => ['new-pane', 'rename-pane', 'close-pane'].includes(args[0])).length;
  assert.equal(await v.clearCompleted(), false);
  assert.equal(calls.filter(args => ['new-pane', 'rename-pane', 'close-pane'].includes(args[0])).length, before);
  assert.ok(!calls.some(args => args[0] === 'stack-panes'));
});

test('absent projection retains running or unknown child, and clear closes only confirmed terminal status', async () => {
  const { calls, states, failStatus, v } = mockView();
  await v.open();
  states.set('one', 'running');
  await v.reconcile([child('one')], dirs);
  const pane = v.panes.get('r:one');
  await v.reconcile([], new Map());
  await v.clearCompleted();
  assert.equal(v.panes.get('r:one'), pane);
  assert.equal(v.finished.size, 0);
  assert.ok(!calls.some(args => args[0] === 'close-pane' && args[2] === pane));
  for (let i = 0; i < 3; i++) {
    failStatus(true);
    await v.reconcile([], new Map());
    await v.clearCompleted();
  }
  assert.equal(v.panes.get('r:one'), pane);
  failStatus(false);
  states.set('one', 'complete');
  await v.reconcile([], new Map());
  assert.equal(v.finished.get('r:one'), pane);
  states.set('one', 'running'); // a later artifact read can revoke stale history classification
  await v.clearCompleted();
  assert.equal(v.panes.get('r:one'), pane);
  states.set('one', 'failed');
  await v.reconcile([], new Map());
  await v.clearCompleted();
  assert.ok(calls.some(args => args[0] === 'close-pane' && args[2] === pane));
});

test('history cap prunes only confirmed terminal children, retaining uncertain panes', async () => {
  const { calls, states, failStatus, v } = mockView();
  await v.open();
  for (let i = 0; i < 22; i++) {
    const done = child(`done${i}`);
    await v.reconcile([done], dirs);
    states.set(done.id, 'complete');
    await v.reconcile([], new Map());
  }
  assert.equal(v.finished.size, 20);
  const retained = child('done21');
  const pane = v.finished.get(retained.key);
  states.set(retained.id, 'running');
  failStatus(true);
  for (let i = 0; i < 3; i++) {
    await v.reconcile([], new Map());
    await v.clearCompleted();
  }
  assert.ok(!calls.some(args => args[0] === 'close-pane' && args[2] === pane));
  failStatus(false);
  await v.reconcile([], new Map());
  assert.equal(v.panes.get(retained.key), pane);
  assert.ok(!calls.some(args => args[0] === 'close-pane' && args[2] === pane));
});

test('mock Zellij caps history at 20 oldest finished panes, preserving active panes', async () => {
  const { calls, states, v } = mockView();
  await v.open();
  const active = child('active');
  await v.reconcile([active], dirs);
  const activeId = v.panes.get(active.key);
  let oldest;
  for (let i = 0; i < 22; i++) {
    const done = child(`done${i}`);
    await v.reconcile([active, done], dirs);
    if (i === 0) oldest = v.panes.get(done.key);
    states.set(done.id, 'complete');
    await v.reconcile([active], dirs);
  }
  assert.equal(v.finished.size, 20);
  assert.equal(v.panes.get(active.key), activeId);
  assert.ok(![...v.finished.values()].includes(oldest));
  assert.ok(calls.some(args => args[0] === 'close-pane' && args[2] === oldest));
  assert.equal(v.emptyPane, undefined);
});
