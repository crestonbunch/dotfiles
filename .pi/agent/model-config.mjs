import { mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const merge = (base, overrides) => Object.fromEntries(
  [...new Set([...Object.keys(base), ...Object.keys(overrides)])].map(key => [
    key,
    Object.hasOwn(overrides, key)
      ? isObject(base[key]) && isObject(overrides[key])
        ? merge(base[key], overrides[key])
        : overrides[key]
      : base[key],
  ]),
);

const readObject = (path, optional = false) => {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw error;
  }
  try {
    const value = JSON.parse(source);
    if (!isObject(value)) throw new Error("expected a JSON object");
    return value;
  } catch (error) {
    throw new Error(`Invalid ${path}: ${error.message}`, { cause: error });
  }
};

const validateChoice = (choice, name) => {
  if (!isObject(choice) || Object.keys(choice).some(key => !["model", "thinking"].includes(key))) {
    throw new Error(`${name}: expected { model, thinking }`);
  }
  if (typeof choice.model !== "string" || !/^[^/\s]+\/\S+$/.test(choice.model)) {
    throw new Error(`${name}.model must be an exact provider/model ID`);
  }
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(choice.thinking)) {
    throw new Error(`${name}.thinking must be a Pi thinking level`);
  }
};

const assignedModels = config => [
  config.parent,
  config.defaultSubagent,
  ...Object.values(config.agents),
].map(choice => choice.model);

/** Missing local choices use shared defaults; malformed choices fail before settings change. */
export const loadModelChoices = agentDir => {
  const config = merge(
    readObject(join(agentDir, "model-defaults.json")),
    readObject(join(agentDir, "model-choices.local.json"), true),
  );
  if (Object.keys(config).some(key => !["parent", "defaultSubagent", "agents", "supportedModels"].includes(key))) {
    throw new Error("Model choices support only parent, defaultSubagent, agents, and supportedModels");
  }
  validateChoice(config.parent, "parent");
  validateChoice(config.defaultSubagent, "defaultSubagent");
  if (!isObject(config.agents)) throw new Error("agents must be an object of role choices");
  for (const [name, choice] of Object.entries(config.agents)) validateChoice(choice, `agents.${name}`);
  if (config.supportedModels !== undefined) {
    if (!Array.isArray(config.supportedModels) || config.supportedModels.length === 0 ||
        config.supportedModels.some(model => typeof model !== "string" || model.includes("*") || !/^[^/\s]+\/\S+$/.test(model))) {
      throw new Error("supportedModels must be a non-empty array of exact provider/model IDs");
    }
    const supported = new Set(config.supportedModels);
    const missing = [...new Set(assignedModels(config))].filter(model => !supported.has(model));
    if (missing.length > 0) {
      throw new Error(`supportedModels must include configured models: ${missing.join(", ")}`);
    }
  }
  return config;
};

const modelSettings = config => {
  const separator = config.parent.model.indexOf("/");
  const supported = [...new Set(config.supportedModels ?? assignedModels(config))];
  return {
    defaultProvider: config.parent.model.slice(0, separator),
    defaultModel: config.parent.model.slice(separator + 1),
    defaultThinkingLevel: config.parent.thinking,
    enabledModels: supported,
    subagents: {
      defaultModel: config.defaultSubagent.model,
      defaultThinking: config.defaultSubagent.thinking,
      agentOverrides: config.agents,
      modelScope: { enforce: true, strict: true, allow: supported },
    },
  };
};

/** Preserve non-model runtime settings, including installed packages and device identity. */
export const applyModelChoices = agentDir => {
  const config = loadModelChoices(agentDir);
  const defaults = readObject(join(agentDir, "settings.defaults.json"));
  const path = join(agentDir, "settings.json");
  // Pi's proper-lockfile uses this same directory. Never race an active settings writer
  // or steal a possibly live lock; report contention so the caller can retry safely.
  const lock = `${path}.lock`;
  try {
    mkdirSync(lock);
  } catch (error) {
    throw new Error(`Cannot lock ${path}; retry after other settings writes finish`, { cause: error });
  }
  const temp = `${path}.${process.pid}.tmp`;
  try {
    const existing = readObject(path, true);
    const configured = modelSettings(config);
    const result = merge(merge(defaults, existing), configured);
    // Scope is owned as a whole so a removed device profile cannot leave stale restrictions.
    result.subagents.modelScope = configured.subagents.modelScope;
    const content = `${JSON.stringify(result, null, 2)}\n`;
    if (content !== JSON.stringify(existing, null, 2) + "\n") {
      writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
      renameSync(temp, path);
    }
    return result;
  } finally {
    rmSync(temp, { force: true });
    rmdirSync(lock);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
    const [command, role, ...extra] = process.argv.slice(2);
    if (command === "--apply" && role === undefined) {
      applyModelChoices(agentDir);
    } else if (command === "--model" && role && extra.length === 0) {
      const config = loadModelChoices(agentDir);
      const choice = role === "parent" ? config.parent : config.agents[role];
      if (!choice) throw new Error(`No configured model for ${role}`);
      console.log(`${choice.model}:${choice.thinking}`);
    } else {
      throw new Error("Usage: node model-config.mjs --apply | --model <parent|agent>");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
