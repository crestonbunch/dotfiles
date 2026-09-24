#!/usr/bin/env node
// Read-only fzf source and selected-entry preview. Never emit prompts, thinking, or metadata.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFileFor } from './transcript.mjs';

const MAX_LINE = 256 * 1024;
const MAX_DETAIL = 12 * 1024;
export function clean(text) {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
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
      if (item?.type === 'text' && typeof item.text === 'string') result.push({ kind: 'assistant', detail: bounded(item.text) });
      else if (item?.type === 'toolCall' && typeof item.name === 'string') {
        const name = bounded(item.name, 80);
        const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
          ? ['path', 'pattern', 'glob', 'query', 'command'].filter(key => typeof item.arguments[key] === 'string')
            .map(key => `${key}=${bounded(redacted(item.arguments[key]), 1000)}`).join('\n') : '';
        result.push({ kind: `tool ${name}`, detail: args ? `${name}\n${bounded(args)}` : name });
      }
    }
    if (message.stopReason === 'error' && typeof message.errorMessage === 'string') result.push({ kind: 'assistant error', detail: bounded(message.errorMessage) });
  } else if (message.role === 'toolResult') {
    const name = typeof message.toolName === 'string' ? bounded(message.toolName, 80) : 'tool';
    const content = Array.isArray(message.content) ? message.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '';
    result.push({ kind: `${message.isError === true ? 'error' : 'result'} ${name}`, detail: bounded(content) });
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
export async function preview(file, id) {
  if (!/^(0|[1-9]\d{0,15}):[0-9]{1,5}$/.test(id)) return '(invalid selection)';
  const [offset, part] = id.split(':').map(Number);
  if (!Number.isSafeInteger(offset)) return '(invalid selection)';
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_LINE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0 || end > MAX_LINE) return '(entry unavailable)';
    const entry = entries(buffer.subarray(0, end).toString('utf8'))[part];
    return entry ? `${entry.kind}\n\n${entry.detail}` : '(entry unavailable)';
  } finally { await handle.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, id] = process.argv.slice(2);
  const dir = process.env.ZELLIJ_CHILD_RUN_DIR;
  const child = process.env.ZELLIJ_CHILD_ID;
  const index = process.env.ZELLIJ_CHILD_INDEX === '' ? undefined : Number(process.env.ZELLIJ_CHILD_INDEX);
  const file = await sessionFileFor(dir, child, index);
  if (!file) { if (mode === '--preview') console.log('(session unavailable)'); else process.exitCode = 2; }
  else if (mode === '--preview') {
    try { console.log(await preview(file, id)); } catch { console.log('(entry unavailable)'); }
  } else if (mode === '--list') {
    await scan(process.stdin, (line, _number, offset) => {
      entries(line).forEach((entry, part) => process.stdout.write(`${row(`${offset}:${part}`, entry)}\n`));
    });
  } else process.exitCode = 2;
}
