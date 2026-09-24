import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Load only direct, always-applied Markdown rules from the personal rules directory. */
export const loadPersonalRules = (rulesDir: string): string => {
  let entries;
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }

  const rules: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = readFileSync(join(rulesDir, entry.name), "utf8");
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(file);
    if (!frontmatter || !/^alwaysApply:[ \t]*true[ \t]*$/m.test(frontmatter[1])) continue;
    rules.push(`### ${entry.name}\n${file.slice(frontmatter[0].length).trim()}`);
  }
  return rules.join("\n\n");
};

export default (
  pi: ExtensionAPI,
  rulesDir = join(homedir(), ".agents", "rules", "personal"),
): void => {
  pi.on("before_agent_start", event => {
    const rules = loadPersonalRules(rulesDir);
    if (rules) {
      event.systemPromptOptions.sections.personal_rules = `## Personal rules\n\n${rules}`;
    } else {
      delete event.systemPromptOptions.sections.personal_rules;
    }
  });
};
