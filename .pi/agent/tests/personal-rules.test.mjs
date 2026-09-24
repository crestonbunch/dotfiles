import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import personalRules, { loadPersonalRules } from "../extensions/personal-rules.ts";

const rulesDirFor = t => {
  const root = mkdtempSync(join(tmpdir(), "pi-personal-rules-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rulesDir = join(root, ".agents", "rules", "personal");
  mkdirSync(rulesDir, { recursive: true });
  return { root, rulesDir };
};

test("loads only always-applied personal rules in filename order", t => {
  const { root, rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "b.md"), "---\nalwaysApply: true\n---\n# B\nB rule\n");
  writeFileSync(join(rulesDir, "a.md"), "---\ndescription: A\nalwaysApply: true\n---\n# A\nA rule\n");
  writeFileSync(join(rulesDir, "optional.md"), "---\nalwaysApply: false\n---\n# Optional\n");
  writeFileSync(join(rulesDir, "no-frontmatter.md"), "# Not a rule\n");
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(root, ".claude", "rules", "other.md"), "---\nalwaysApply: true\n---\n# Claude\n");
  writeFileSync(join(root, ".cursor", "rules", "other.md"), "---\nalwaysApply: true\n---\n# Cursor\n");

  assert.equal(loadPersonalRules(rulesDir), "### a.md\n# A\nA rule\n\n### b.md\n# B\nB rule");
});

test("adds personal rules to the system prompt section on agent start", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Routing\nDelegate work.\n");
  let handler;
  personalRules({ on: (_name, callback) => { handler = callback; } }, rulesDir);
  const event = { systemPromptOptions: { sections: {} } };

  handler(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# Routing\nDelegate work.");
});

test("removes stale personal rules when they are no longer present", t => {
  const { rulesDir } = rulesDirFor(t);
  let handler;
  personalRules({ on: (_name, callback) => { handler = callback; } }, rulesDir);
  const event = { systemPromptOptions: { sections: { personal_rules: "stale" } } };

  handler(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, undefined);
});
