import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ForkPolicy } from "./types.ts";

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
}

export interface AgentProfile {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinkingLevel?: string;
  prompt: string;
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ["scout", "researcher", "planner", "reviewer", "debugger"];

export const loadAgents = async (): Promise<AgentProfile[]> =>
  Promise.all(names.map(async (name) => {
    const content = await readFile(join(packageRoot, "agents", `${name}.md`), "utf8");
    const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
    const tools = typeof frontmatter.tools === "string"
      ? frontmatter.tools.split(",").map((tool) => tool.trim()).filter(Boolean)
      : [];
    return {
      name: String(frontmatter.name ?? name),
      description: String(frontmatter.description ?? ""),
      tools,
      model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      thinkingLevel: typeof frontmatter.thinkingLevel === "string" ? frontmatter.thinkingLevel : undefined,
      prompt: body.trim(),
    };
  }));

export const childPrompt = (
  profile: AgentProfile,
  task: string,
  forkPolicy: ForkPolicy,
  assignment?: string,
): string => `${profile.prompt}

Task: ${task}
${assignment ? `\nAssignment contract:\n${assignment}\n` : ""}
Fork policy: ${forkPolicy}. ${forkPolicy === "deny" ? "Report newly discovered independent work to your parent." : "Create another workspace only for an independent deliverable that cannot stay in this workspace."}
Use Luna only for information or summaries without analysis. Use Terra for analysis or source explanations without decisions. Use Sol for decisions, difficult coding, or deep analysis. Increase the model tier or thinking level when a lower result is unsatisfactory.
Do not use another subagent plugin while pizj mode is active.
Return a concise report with findings, files, commands, and unresolved questions.`;

export const workerPrompt = (
  task: string,
  assignment: string,
  forkPolicy: ForkPolicy,
): string => `Complete this workspace assignment.

Task: ${task}

Assignment contract:
${assignment}

Fork policy: ${forkPolicy}. ${forkPolicy === "deny" ? "Report newly discovered work to your parent instead of opening another workspace." : "Open another workspace only for an independent repository or modifying deliverable."}

Work only in this tab's jj workspace. Do not use another subagent plugin while pizj mode is active. Use Sol for decisions, difficult coding, and deep analysis. Increase the thinking level when the result is unsatisfactory. Give each revision a description. Run the required tests. Report the final revision range, tests, conflicts, and unfinished work.`;
