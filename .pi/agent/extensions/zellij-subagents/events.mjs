#!/usr/bin/env node
// Read-only fzf source and selected-entry preview. Never emit prompts, thinking, or metadata.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFileFor } from './transcript.mjs';

const MAX_LINE = 256 * 1024;
const MAX_DETAIL = 12 * 1024;
export function clean(text) {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*?(?:\x07|\x1b\\))?/g, '')
    .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
function bounded(value, max = MAX_DETAIL) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}
function redacted(value) {
  return value.replace(/\b(token|password|secret|api[_-]?key)\s*=\s*([^\s]+)/gi, '$1=[redacted]');
}
export function entries(line) {
  let event;
  try { event = JSON.parse(line); } catch { return []; }
  if (event?.type !== 'message' || !event.message || typeof event.message !== 'object') return [];
  const message = event.message;
  const result = [];
  if (message.role === 'assistant') {
    if (Array.isArray(message.content)) for (const item of message.content) {
      if (item?.type === 'text' && typeof item.text === 'string') result.push({ kind: 'assistant', format: 'markdown', detail: bounded(item.text) });
      else if (item?.type === 'toolCall' && typeof item.name === 'string') {
        const name = bounded(item.name, 80).replace(/\s/g, ' ');
        const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
          ? ['path', 'pattern', 'glob', 'query', 'command'].filter(key => typeof item.arguments[key] === 'string')
            .map(key => `${key}=${bounded(redacted(item.arguments[key]), 1000)}`).join('\n') : '';
        result.push({ kind: `tool ${name}`, toolCallId: item.id, path: typeof item.arguments?.path === 'string' ? bounded(item.arguments.path, 1000) : undefined,
          language: name === 'bash' ? 'bash' : undefined, detail: args ? `${name}\n${bounded(args)}` : name });
      }
    }
    if (message.stopReason === 'error' && typeof message.errorMessage === 'string') result.push({ kind: 'assistant error', detail: bounded(message.errorMessage) });
  } else if (message.role === 'toolResult') {
    const name = typeof message.toolName === 'string' ? bounded(message.toolName, 80).replace(/\s/g, ' ') : 'tool';
    const content = Array.isArray(message.content) ? message.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '';
    result.push({ kind: `${message.isError === true ? 'error' : 'result'} ${name}`, toolCallId: message.toolCallId, detail: bounded(content) });
  }
  return result;
}
export function row(id, entry) {
  const summary = bounded(entry.detail.replace(/\s+/g, ' ').trim(), 140);
  return `${id}\t${entry.kind}: ${summary || '(empty)'}`;
}
// Split bytes, not strings: a single untrusted JSONL line can never grow without bound.
export async function scan(stream, onLine) {
  let pending = Buffer.alloc(0), lineNumber = 0, oversized = false, consumed = 0, lineStart = 0;
  for await (const chunk of stream) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let i = 0; i < data.length; i++) if (data[i] === 10) {
      const segment = data.subarray(start, i);
      lineNumber++;
      if (!oversized && pending.length + segment.length <= MAX_LINE) {
        if (await onLine(Buffer.concat([pending, segment]).toString('utf8'), lineNumber, lineStart) === false) return;
      }
      pending = Buffer.alloc(0); oversized = false; start = i + 1;
      lineStart = consumed + start;
    }
    const remainder = data.subarray(start);
    if (pending.length + remainder.length > MAX_LINE) { pending = Buffer.alloc(0); oversized = true; }
    else if (!oversized) pending = Buffer.concat([pending, remainder]);
    consumed += data.length;
  }
}
// A result may carry the byte address of its tool call, not an arbitrary path.
// This keeps file-type inference bounded even in very large transcripts.
export async function preview(file, id, { renderer, raw = true, width = 80 } = {}) {
  if (!/^(0|[1-9]\d{0,15}):[0-9]{1,5}(?::(0|[1-9]\d{0,15}):[0-9]{1,5})?$/.test(id)) return '(invalid selection)';
  const [offset, part, callOffset, callPart] = id.split(':').map(Number);
  if (!Number.isSafeInteger(offset) || (callOffset !== undefined && !Number.isSafeInteger(callOffset))) return '(invalid selection)';
  const handle = await fs.promises.open(file, 'r');
  try {
    async function at(position, index) {
      const buffer = Buffer.alloc(MAX_LINE + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      const end = buffer.subarray(0, bytesRead).indexOf(10);
      return end < 0 || end > MAX_LINE ? undefined : entries(buffer.subarray(0, end).toString('utf8'))[index];
    }
    const entry = await at(offset, part);
    if (!entry) return '(entry unavailable)';
    if (entry.kind === 'result read' && callOffset !== undefined && callOffset < offset) {
      const call = await at(callOffset, callPart);
      if (call?.kind === 'tool read' && typeof call.toolCallId === 'string' && call.toolCallId === entry.toolCallId) entry.path = call.path;
    }
    let detail = entry.detail;
    if (!raw && renderer) {
      try { detail = await renderer(entry, width); }
      catch (error) {
        const reason = bounded(String(error?.message ?? error), 180).replace(/\s/g, ' ');
        detail = `(formatting unavailable: ${reason})\n\n${entry.detail}`;
      }
    }
    return `${entry.kind}\n\n${detail}`;
  } finally { await handle.close(); }
}

export async function list(stream, emit) {
  const calls = new Map();
  await scan(stream, (line, _number, offset) => {
    entries(line).forEach((entry, part) => {
      let id = `${offset}:${part}`;
      if (entry.kind.startsWith('tool ') && typeof entry.toolCallId === 'string' && entry.toolCallId.length <= 256) {
        calls.set(entry.toolCallId, id);
        if (calls.size > 10000) calls.delete(calls.keys().next().value);
      } else if (typeof entry.toolCallId === 'string' && calls.has(entry.toolCallId)) {
        id += `:${calls.get(entry.toolCallId)}`;
        calls.delete(entry.toolCallId);
      }
      emit(row(id, entry));
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, id] = process.argv.slice(2);
  const dir = process.env.ZELLIJ_CHILD_RUN_DIR;
  const child = process.env.ZELLIJ_CHILD_ID;
  const index = process.env.ZELLIJ_CHILD_INDEX === '' ? undefined : Number(process.env.ZELLIJ_CHILD_INDEX);
  const file = await sessionFileFor(dir, child, index);
  if (!file) { if (mode === '--preview') console.log('(session unavailable)'); else process.exitCode = 2; }
  else if (mode === '--preview') {
    try {
      const { loadRenderer } = await import('./preview.mjs');
      const raw = process.env.FZF_PREVIEW_LABEL === 'Raw';
      const renderer = raw ? undefined : async (entry, width) => (await loadRenderer(process.env.ZELLIJ_PI_PACKAGE))(entry, width);
      console.log(await preview(file, id, { renderer, raw, width: Number(process.env.FZF_PREVIEW_COLUMNS) || 80 }));
    } catch { console.log('(entry unavailable)'); }
  } else if (mode === '--list') {
    await list(process.stdin, value => process.stdout.write(`${value}\n`));
  } else process.exitCode = 2;
}
