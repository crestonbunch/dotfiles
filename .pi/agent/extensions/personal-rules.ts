import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PersonalRule = { name: string; content: string };

/** Read only direct, always-applied Markdown rules from the personal rules directory. */
const readPersonalRules = (rulesDir: string): PersonalRule[] => {
  let entries;
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const rules: PersonalRule[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = readFileSync(join(rulesDir, entry.name), "utf8");
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(file);
    if (!frontmatter || !/^alwaysApply:[ \t]*true[ \t]*$/m.test(frontmatter[1])) continue;
    rules.push({ name: entry.name, content: file.slice(frontmatter[0].length).trim() });
  }
  return rules;
};

const renderPersonalRules = (rules: PersonalRule[]): string =>
  rules.map(rule => `### ${rule.name}\n${rule.content}`).join("\n\n");

export const loadPersonalRules = (rulesDir: string): string =>
  renderPersonalRules(readPersonalRules(rulesDir));

// Own only this marked block; preserve forced role and child-boundary text verbatim.
const forcedRulesBlock = /(?:\n\n)?<!-- pi-personal-rules:start -->[\s\S]*?<!-- pi-personal-rules:end -->/g;

export default (
  pi: ExtensionAPI,
  rulesDir = join(homedir(), ".agents", "rules", "personal"),
): void => {
  let rules: PersonalRule[] = [];
  pi.on("session_start", () => {
    rules = readPersonalRules(rulesDir);
  });

  pi.registerCommand("rules", {
    description: "Show loaded personal rules",
    handler: (_args, ctx) => {
      const size = Buffer.byteLength(rules.map(rule => rule.content).join("\n\n"), "utf8");
      const summary = rules.length
        ? `${rules.length} personal rules (${size} bytes):\n${rules.map(rule => `- ${rule.name}`).join("\n")}`
        : "No always-applied personal rules found";
      ctx.ui.notify(summary, "info");
    },
  });

  pi.on("before_agent_start", event => {
    const content = renderPersonalRules(rules);
    const options = event.systemPromptOptions;
    const section = content ? `## Personal rules\n\n${content}` : undefined;
    if (section) {
      options.sections.personal_rules = section;
    } else {
      delete options.sections.personal_rules;
    }
    // Pi renders forceSystemPrompt instead of sections for rewritten child prompts.
    if (typeof options.forceSystemPrompt === "string") {
      const base = options.forceSystemPrompt.replace(forcedRulesBlock, "");
      options.forceSystemPrompt = section
        ? `${base}${base ? "\n\n" : ""}<!-- pi-personal-rules:start -->\n${section}\n<!-- pi-personal-rules:end -->`
        : base;
    }
  });
};
