import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The host supplies its package root explicitly: standalone Node does not get
// Pi's extension import aliases, and must not depend on a Homebrew/npm location.
// Initialization and rendering errors share preview()'s raw-text fallback.
export async function loadRenderer(packageDir) {
  if (!packageDir) throw new Error('reopen this tab after /reload');
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.name !== '@earendil-works/pi-coding-agent') throw new Error('invalid Pi package');
  const pi = await import(pathToFileURL(path.resolve(packageDir, manifest.main)).href);
  const require = createRequire(manifestPath);
  const tui = await import(pathToFileURL(require.resolve('@earendil-works/pi-tui')).href);
  pi.initTheme('system', false);
  return (entry, width) => renderPreview(entry, width, pi, tui);
}

function renderPreview(entry, width, pi, tui) {
  const text = entry.detail.replace(/\t/g, '    ');
  let rendered;
  if (entry.format === 'markdown') {
    const markdown = new tui.Markdown(text, 0, 0, pi.getMarkdownTheme());
    rendered = markdown.render(Math.max(1, Math.min(1000, width))).join('\n');
  } else {
    const diff = /^(?:diff --git |@@ -\d|--- .+\n\+\+\+ )/m.test(text);
    const language = diff ? 'diff' : entry.language ?? (entry.path ? pi.getLanguageFromPath(entry.path) : undefined);
    rendered = language ? pi.highlightCode(text, language).join('\n') : text;
  }
  // Markdown may generate hyperlinks or other terminal sequences. Previews only
  // allow SGR styling, never OSC links, clipboard writes, cursor moves or images.
  return rendered.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*?(?:\x07|\x1b\\))?/g,
    sequence => /^\x1b\[[0-9;:]*m$/.test(sequence) ? sequence : '');
}
