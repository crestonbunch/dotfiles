import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const ACTIVE = new Set(['queued', 'running']);
const PANE_ID = /^terminal_[0-9]+$/;
const TAB_ID = /^[0-9]+$/;
const MAX_CHILDREN = 20;
const MAX_FINISHED = 20;
const TERMINAL = new Set(['complete', 'completed', 'failed', 'cancelled', 'canceled']);

async function readRunStatus(dir) {
  const file = path.join(dir, 'status.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > 512 * 1024) return undefined;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function activeChildren(snapshot) {
  if (snapshot?.kind !== 'pi-subagents.async-status-snapshot' || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) throw new Error('Invalid async status snapshot');
  if (snapshot.omitted?.runs || snapshot.omitted?.children || snapshot.omitted?.byteLimitExceeded) throw new Error('Async snapshot is truncated; refusing destructive reconciliation');
  const children = [];
  function visit(node, root, ancestors = []) {
    if (!node || typeof node.id !== 'string' || typeof node.label !== 'string' || !['subagent', 'workflow', 'step', 'host-step'].includes(node.kind)) return;
    if (node.kind === 'host-step' || !ACTIVE.has(node.state)) return;
    // A single run has a step projection of the same child. Workflow roots instead contain lanes.
    if (node.kind === 'step' || (node.kind === 'subagent' && ancestors.at(-1)?.kind !== 'step' && node !== root)) {
      const key = `${root.id}:${ancestors.map(parent => parent.id).join('/')}:${node.id}`;
      children.push({ key, rootId: root.id, id: node.id, label: node.label, index: node.kind === 'step' && /^step:\d+$/.test(node.id) ? Number(node.id.slice(5)) : undefined });
    } else if (node === root && node.kind === 'subagent' && !node.children?.length) {
      children.push({ key: `${root.id}:root`, rootId: root.id, id: root.id, label: root.label, index: 0 });
    }
    for (const child of node.children ?? []) visit(child, root, [...ancestors, node]);
  }
  for (const root of snapshot.runs) {
    if (!root || typeof root.id !== 'string' || !ACTIVE.has(root.state)) continue;
    visit(root, root);
  }
  if (children.length > MAX_CHILDREN) throw new Error('More than 20 visible async children; refusing partial reconciliation');
  return children;
}

export function selectStep(status, childId, index) {
  if (!status || !Array.isArray(status.steps)) return undefined;
  if (childId === status.runId && status.steps.length === 1) return { step: status.steps[0], index: 0 };
  const found = status.steps.findIndex((step, n) => step?.workflowKey === childId || step?.runId === childId || childId === `step:${n}`);
  if (found >= 0) return { step: status.steps[found], index: found };
  if (Number.isSafeInteger(index) && index >= 0 && status.steps[index]) return { step: status.steps[index], index };
  return undefined;
}

export function validRunDirectory(dir, runId) {
  return typeof dir === 'string' && path.isAbsolute(dir) && typeof runId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(runId) && path.basename(dir) === runId && !dir.includes('\0');
}

export function tabList(json) {
  const tabs = JSON.parse(json);
  if (!Array.isArray(tabs)) throw new Error('Invalid Zellij tab list');
  return tabs;
}
export function paneList(json) {
  const panes = JSON.parse(json);
  if (!Array.isArray(panes)) throw new Error('Invalid Zellij pane list');
  return panes;
}
function tabId(tab) { return String(tab.tab_id ?? tab.id ?? ''); }
function paneId(pane) {
  const id = pane.pane_id ?? pane.id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) return `${pane.is_plugin ? 'plugin' : 'terminal'}_${id}`;
  return typeof id === 'string' ? id : '';
}
function paneTabId(pane) { return String(pane.tab_id ?? pane.tabId ?? pane.tab?.id ?? ''); }

export class ZellijView {
  constructor({ cli = async (args) => (await execFile('zellij', ['action', ...args], { timeout: 4000, maxBuffer: 256 * 1024 })).stdout, viewer, name, readStatus = readRunStatus }) {
    this.cli = cli;
    this.viewer = viewer;
    this.name = name;
    this.tab = undefined;
    this.panes = new Map();
    this.labels = new Map();
    this.finished = new Map();
    this.sources = new Map();
    this.readStatus = readStatus;
    this.emptyPane = undefined;
    this.chromePanes = new Set();
  }
  async inventory() {
    const [tabs, panes] = await Promise.all([this.cli(['list-tabs', '--json']), this.cli(['list-panes', '--json', '--tab'])]);
    return { tabs: tabList(tabs), panes: paneList(panes) };
  }
  async owned() {
    const { tabs, panes } = await this.inventory();
    const tab = tabs.find(t => tabId(t) === this.tab && t.name === this.name);
    if (!tab) { this.tab = undefined; this.panes.clear(); this.labels.clear(); this.finished.clear(); this.sources.clear(); this.emptyPane = undefined; this.chromePanes.clear(); return false; }
    const inTab = panes.filter(p => paneTabId(p) === this.tab);
    const known = new Set([...this.panes.values(), ...this.finished.values(), this.emptyPane, ...this.chromePanes].filter(Boolean));
    if (inTab.some(p => !known.has(paneId(p))) || [...known].some(id => !inTab.some(p => paneId(p) === id))) throw new Error('Zellij tab panes changed externally; refusing to modify them');
    return true;
  }
  async open() {
    if (this.tab && await this.owned()) return;
    const raw = (await this.cli(['new-tab', '--no-focus', '--name', this.name, '--', process.execPath, this.viewer, '--idle'])).trim();
    if (!TAB_ID.test(raw)) throw new Error('Zellij did not return a tab ID');
    this.tab = raw;
    const { tabs, panes } = await this.inventory();
    if (!tabs.some(t => tabId(t) === raw && t.name === this.name)) throw new Error('New Zellij tab could not be verified');
    const inTab = panes.filter(p => paneTabId(p) === raw);
    const created = inTab.filter(p => PANE_ID.test(paneId(p)));
    if (created.length !== 1 || inTab.some(p => !PANE_ID.test(paneId(p)) && !/^plugin_[0-9]+$/.test(paneId(p)))) throw new Error('New Zellij tab did not have one placeholder terminal pane');
    this.chromePanes = new Set(inTab.filter(p => /^plugin_[0-9]+$/.test(paneId(p))).map(paneId));
    this.emptyPane = paneId(created[0]);
  }
  async focus() { if (this.tab && await this.owned()) await this.cli(['go-to-tab-by-id', this.tab]); }
  async visible() {
    if (!this.tab) return false;
    const tabs = tabList(await this.cli(['list-tabs', '--json']));
    return tabs.some(t => tabId(t) === this.tab && t.name === this.name && t.active === true);
  }
  // A missing projection is not a terminal state. Only an identified, terminal
  // step in the canonical artifact authorizes history placement or deletion.
  async isTerminal(key) {
    const source = this.sources.get(key);
    if (!source || !validRunDirectory(source.dir, source.rootId)) return false;
    try {
      const status = await this.readStatus(source.dir);
      if (status?.runId !== source.rootId || !Array.isArray(status.steps)) return false;
      const steps = status.steps;
      const index = steps.findIndex((step, n) => step?.workflowKey === source.id || step?.runId === source.id || source.id === `step:${n}`);
      const step = index >= 0 ? steps[index] : source.id === source.rootId && steps.length === 1 ? steps[0] : undefined;
      return TERMINAL.has(step?.status);
    } catch { return false; } // malformed, missing or unreadable status: retain pane
  }
  // Recheck visibility after every awaited read, immediately before each mutation.
  // Zellij layout actions can activate the target tab even with --no-focus.
  async layout(args) {
    if (!await this.visible()) return false;
    return this.cli(args);
  }
  async reconcile(children, dirs) {
    if (!this.tab || !await this.owned() || !await this.visible()) return false;
    // Missing RPC details are not authority to close an existing child pane.
    if (children.some(c => !validRunDirectory(dirs.get(c.rootId), c.rootId))) throw new Error('Async run directory unavailable; retaining existing panes');
    const desired = new Map(children.map(c => [c.key, c]));
    for (const child of children) {
      if (this.panes.has(child.key)) continue;
      if (this.finished.has(child.key)) {
        const pane = this.finished.get(child.key);
        if (await this.layout(['rename-pane', '--pane-id', pane, child.label.slice(0, 60)]) === false) return false;
        this.finished.delete(child.key);
        this.panes.set(child.key, pane);
        this.labels.set(child.key, child.label);
        this.sources.set(child.key, { ...child, dir: dirs.get(child.rootId) });
        continue;
      }
      const args = ['new-pane', '--tab-id', this.tab, '--stacked', '--no-focus', '--name', child.label.slice(0, 60), '--', process.execPath, this.viewer, '--run-dir', dirs.get(child.rootId), '--child-id', child.id];
      if (child.index !== undefined) args.push('--index', String(child.index));
      const created = await this.layout(args);
      if (created === false) return false;
      const pane = created.trim();
      if (!PANE_ID.test(pane)) throw new Error('Zellij did not return a terminal pane ID');
      const { panes } = await this.inventory();
      if (!panes.some(p => paneId(p) === pane && paneTabId(p) === this.tab)) throw new Error('New pane was not created in the owned tab');
      this.panes.set(child.key, pane);
      this.labels.set(child.key, child.label);
      this.sources.set(child.key, { ...child, dir: dirs.get(child.rootId) });
    }
    if ((children.length || this.finished.size) && this.emptyPane) {
      if (await this.layout(['close-pane', '--pane-id', this.emptyPane]) === false) return false;
      this.emptyPane = undefined;
    }
    for (const [key, pane] of this.panes) {
      if (desired.has(key)) continue;
      if (!await this.isTerminal(key)) continue;
      if (await this.layout(['rename-pane', '--pane-id', pane, `Finished · ${this.labels.get(key) ?? key}`.slice(0, 60)]) === false) return false;
      this.panes.delete(key);
      this.finished.set(key, pane);
    }
    // Recheck before pruning: a stale completed classification is never authority.
    for (const [key, pane] of this.finished) {
      if (desired.has(key) || await this.isTerminal(key)) continue;
      if (await this.layout(['rename-pane', '--pane-id', pane, (this.labels.get(key) ?? key).slice(0, 60)]) === false) return false;
      this.finished.delete(key);
      this.panes.set(key, pane);
    }
    for (const [key, pane] of this.finished) {
      if (this.finished.size <= MAX_FINISHED) break;
      if (!await this.isTerminal(key)) continue;
      if (await this.layout(['close-pane', '--pane-id', pane]) === false) return false;
      this.finished.delete(key);
      this.sources.delete(key);
      this.labels.delete(key);
    }
    return this.ensurePlaceholder();
  }
  async ensurePlaceholder() {
    if (this.panes.size || this.finished.size || this.emptyPane) return true;
    const created = await this.layout(['new-pane', '--tab-id', this.tab, '--stacked', '--no-focus', '--name', 'No active async children', '--', process.execPath, this.viewer, '--idle']);
    if (created === false) return false;
    const pane = created.trim();
    if (!PANE_ID.test(pane)) throw new Error('Zellij did not return a placeholder pane ID');
    const { panes } = await this.inventory();
    if (!panes.some(p => paneId(p) === pane && paneTabId(p) === this.tab)) throw new Error('Placeholder pane is outside owned tab');
    this.emptyPane = pane;
    return true;
  }
  async clearCompleted() {
    if (!this.tab || !await this.owned() || !await this.visible()) return false;
    for (const [key, pane] of this.finished) {
      if (!await this.isTerminal(key)) {
        if (await this.layout(['rename-pane', '--pane-id', pane, (this.labels.get(key) ?? key).slice(0, 60)]) === false) return false;
        this.finished.delete(key);
        this.panes.set(key, pane);
        continue;
      }
      if (await this.layout(['close-pane', '--pane-id', pane]) === false) return false;
      this.finished.delete(key);
      this.sources.delete(key);
      this.labels.delete(key);
    }
    return this.ensurePlaceholder();
  }
  // On reload/shutdown, leave the dedicated tab and its viewers available to the user.
  // A new extension instance cannot safely adopt pane ownership from a previous instance.
  async shutdown() {
    this.tab = undefined;
    this.panes.clear();
    this.labels.clear();
    this.finished.clear();
    this.sources.clear();
    this.emptyPane = undefined;
    this.chromePanes.clear();
  }
}
