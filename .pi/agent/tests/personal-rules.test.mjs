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
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  const event = { systemPromptOptions: { sections: {} } };

  handlers.get("session_start")();
  handlers.get("before_agent_start")(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# Routing\nDelegate work.");
});

test("removes stale personal rules when they are no longer present", t => {
  const { rulesDir } = rulesDirFor(t);
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  const event = { systemPromptOptions: { sections: { personal_rules: "stale" } } };

  handlers.get("session_start")();
  handlers.get("before_agent_start")(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, undefined);
});

test("keeps session rules until session start reloads them", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Old\n");
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  handlers.get("session_start")();
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# New\n");
  const beforeReload = { systemPromptOptions: { sections: {} } };
  handlers.get("before_agent_start")(beforeReload);
  assert.equal(beforeReload.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# Old");

  handlers.get("session_start")();
  const afterReload = { systemPromptOptions: { sections: {} } };
  handlers.get("before_agent_start")(afterReload);
  assert.equal(afterReload.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# New");
});

test("/rules reports cached names and size", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Rule\n");
  const handlers = new Map();
  let command;
  let notification;
  personalRules({
    on: (name, callback) => { handlers.set(name, callback); },
    registerCommand: (name, definition) => { assert.equal(name, "rules"); command = definition; },
  }, rulesDir);
  handlers.get("session_start")();
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Changed\n");

  command.handler("", { ui: { notify: text => { notification = text; } } });

  assert.equal(notification, "1 personal rules (6 bytes):\n- routing.md");
});
