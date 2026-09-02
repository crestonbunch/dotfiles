import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { SessionManager, truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { childPrompt, loadAgents, workerPrompt } from "./agents.ts";
import {
  cloneRepository,
  createWorkspace,
  forgetWorkspace,
  inspectRepository,
  rebaseRevisions,
  resolveRevision,
  restoreWorkspace,
  snapshotRevision,
  revisionRange,
} from "./jj.ts";
import { readResult, readWorkflow, getResultPath, listWorkflows, saveWorkflow, updateWorkflow, withStateLock, writeResult } from "./store.ts";
import { shortId, slugify, tabLabel, waitFor, workflowId } from "./runtime.ts";
import type { ForkPolicy, Limits, RunCommand, WorkflowManifest, WorkspaceRecord } from "./types.ts";
import { closePane, closeTab, findCurrentTab, openPane, openTab } from "./zellij.ts";

const TOOL_NAMES = ["pizj_delegate", "pizj_open_workspace", "pizj_wait_workspace", "pizj_integrate", "pizj_remove_workspace"];
const CHILD_RUNNER = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "child-runner.mjs");
const DEFAULT_LIMITS: Limits = {
  maxDepth: 2,
  maxWorkspaceTabs: 8,
  maxSubagentsPerTab: 4,
  maxChildTabsPerNonRoot: 2,
};
const ForkPolicySchema = StringEnum(["deny", "ask", "allow"] as const);
const ThinkingSchema = StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const);

interface ChildResult {
  childId: string;
  sessionFile?: string;
  text: string;
  stopReason?: string;
  revisions?: Array<{ commitId: string; changeId: string }>;
}

const textOf = (message: AssistantMessage | undefined): string => {
  if (!message) return "";
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
};

const lastAssistant = (ctx: ExtensionContext): AssistantMessage | undefined => {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message.role === "assistant") return entry.message;
  }
  return undefined;
};

const isReadOnlyCommand = (command: string): boolean => {
  if (/[;&|`$(){}<>\n]|\brm\b|\bmv\b|\bcp\b|\btee\b|\bsed\s+-i\b|\bfind\b.*\s-(delete|exec|execdir|ok|okdir)\b|\bjj\s+(describe|new|commit|rebase|squash|abandon|bookmark|workspace)\b|\bgit\s+(add|commit|reset|checkout|switch|rebase|merge|clean)\b/.test(command)) return false;
  return /^(rg|grep|find|fd|ls|pwd|cat|head|tail|wc|stat|file|git\s+(status|diff|log|show)|jj\s+(st|status|diff|log|show)|npm\s+(test|run\s+test)|make\s+test|\.\/run\.sh\s+test|duo\s+wb\s+run)/.test(command.trim());
};

const normalizeModel = (model: string | undefined): string | undefined => {
  const aliases: Record<string, string> = {
    luna: "gpt-5.6-luna",
    terra: "gpt-5.6-terra",
    sol: "gpt-5.6-sol",
  };
  return model ? aliases[model.toLowerCase()] ?? model : undefined;
};

const validateModel = (agent: string, model: string | undefined): void => {
  if (!model) return;
  const lower = model.toLowerCase();
  if ((agent === "planner" || agent === "reviewer" || agent === "worker") && (lower.includes("luna") || lower.includes("terra"))) {
    throw new Error(`${agent} makes decisions or modifies code and must use Sol or another decision-capable model`);
  }
  if (agent === "debugger" && lower.includes("luna")) {
    throw new Error("debugger requires analysis and cannot use Luna");
  }
};

const formatWorkflow = (manifest: WorkflowManifest): string => {
  const activePanes = manifest.panes.filter((pane) => pane.state === "active").length;
  const activeWorkspaces = manifest.workspaces.filter((workspace) => workspace.state === "active" || workspace.state === "reported").length;
  return `${manifest.id}: ${manifest.state}, ${activeWorkspaces} workspaces, ${activePanes} subagents`;
};

export default (pi: ExtensionAPI): void => {
  let enabled = false;
  let toolsBeforeMode: string[] | undefined;
  let currentWorkflowId = process.env.PIZJ_WORKFLOW_ID;
  const currentPaneId = (process.env.ZELLIJ_PANE_ID ?? "").replace(/^terminal_/, "");
  const zellijSession = process.env.ZELLIJ_SESSION_NAME ?? "";
  const run: RunCommand = async (command, args, options) => {
    const result = await pi.exec(command, args, options);
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  };
  const childLaunch = async (
    resultFile: string,
    environment: Record<string, string>,
    command: string[],
  ): Promise<{ command: string[]; launchFile: string }> => {
    const launchFile = `${resultFile}.launch.json`;
    await mkdir(dirname(launchFile), { recursive: true });
    await writeFile(launchFile, `${JSON.stringify({ environment, command })}\n`, { mode: 0o600 });
    return { command: [process.execPath, CHILD_RUNNER, "--spec", launchFile], launchFile };
  };
  const withZellijLock = <T>(action: () => Promise<T>): Promise<T> => {
    const id = createHash("sha256").update(zellijSession).digest("hex").slice(0, 16);
    return withStateLock(`zellij-${id}`, action);
  };
  const openStartedPane = async (
    input: Parameters<typeof openPane>[1],
    startedFile: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pane = await openPane(run, input);
      try {
        await waitFor(async () => access(startedFile).then(() => true).catch(() => undefined), attempt === 0 ? 2000 : 10_000, signal);
        return pane;
      } catch (error) {
        await closePane(run, input.session, pane).catch(() => undefined);
        await rm(startedFile, { force: true });
        if (signal?.aborted || attempt === 1) {
          throw new Error(`The Zellij pane process did not start: ${String(error)}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    throw new Error("The Zellij pane process did not start");
  };

  const isOtherSubagentTool = (name: string): boolean => {
    if (TOOL_NAMES.includes(name)) return false;
    const tool = pi.getAllTools().find((candidate) => candidate.name === name);
    const text = `${name} ${tool?.description ?? ""}`;
    return /sub.?agent|spawn.{0,12}agent|delegate.{0,12}(task|agent)|background agent|agent.{0,12}task/i.test(text);
  };

  const permittedPizjTools = (): string[] => {
    if (!process.env.PIZJ_CHILD_ID) return TOOL_NAMES;
    const tools = ["pizj_delegate"];
    if (process.env.PIZJ_FORK_POLICY !== "deny") tools.push("pizj_open_workspace", "pizj_wait_workspace");
    return tools;
  };

  const setMode = (value: boolean, ctx: ExtensionContext): void => {
    if (value) {
      toolsBeforeMode ??= pi.getActiveTools();
      const active = toolsBeforeMode.filter((name) => !TOOL_NAMES.includes(name) && !isOtherSubagentTool(name));
      pi.setActiveTools([...new Set([...active, ...permittedPizjTools()])]);
    } else {
      pi.setActiveTools(toolsBeforeMode ?? pi.getActiveTools().filter((name) => !TOOL_NAMES.includes(name)));
      toolsBeforeMode = undefined;
    }
    enabled = value;
    ctx.ui.setStatus("pizj", value ? ctx.ui.theme.fg("accent", `pizj ${currentWorkflowId ?? "on"}`) : undefined);
    pi.appendEntry("pizj-mode", { enabled: value, workflowId: currentWorkflowId });
  };

  const requireEnvironment = (): void => {
    if (!zellijSession || !currentPaneId) throw new Error("pizj requires Pi to run inside zellij");
  };

  const ensureWorkflow = async (ctx: ExtensionContext): Promise<WorkflowManifest> => {
    requireEnvironment();
    if (currentWorkflowId) return readWorkflow(currentWorkflowId);
    const repository = await inspectRepository(run, ctx.cwd);
    const current = await resolveRevision(run, ctx.cwd, "@");
    const base = await resolveRevision(run, ctx.cwd, "@-");
    const tabId = await findCurrentTab(run, zellijSession, currentPaneId);
    currentWorkflowId = workflowId(ctx.cwd, ctx.sessionManager.getSessionId());
    const now = new Date().toISOString();
    const rootWorkspaceId = `${currentWorkflowId}-root`;
    const manifest: WorkflowManifest = {
      version: 1,
      id: currentWorkflowId,
      ownerSessionId: ctx.sessionManager.getSessionId(),
      zellijSession,
      rootPaneId: currentPaneId,
      rootWorkspaceId,
      state: "active",
      limits: DEFAULT_LIMITS,
      panes: [],
      workspaces: [{
        id: rootWorkspaceId,
        kind: "root",
        repositoryId: repository.id,
        repositoryRoot: repository.root,
        integrationPath: repository.root,
        remoteUrl: repository.remoteUrl,
        workspaceName: "root",
        path: repository.root,
        baseCommit: base.commitId,
        headCommit: current.commitId,
        parentPaneId: currentPaneId,
        tabId,
        tabName: `${slugify(repository.root.split("/").pop() ?? "repo")}: root`,
        depth: 0,
        task: "Root workflow",
        forkPolicy: "allow",
        state: "active",
        createdAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(manifest);
    return manifest;
  };

  const requireOwner = (manifest: WorkflowManifest, ctx: ExtensionContext): void => {
    if (ctx.sessionManager.getSessionId() !== manifest.ownerSessionId) {
      throw new Error("Only the root pizj coordinator can finish, integrate, or remove workflow resources");
    }
  };

  const workspaceFor = (manifest: WorkflowManifest, cwd: string): WorkspaceRecord => {
    const candidates = manifest.workspaces
      .filter((workspace) => cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))
      .sort((left, right) => right.path.length - left.path.length);
    const workspace = candidates[0];
    if (!workspace) throw new Error(`This tab is not registered in workflow ${manifest.id}`);
    return workspace;
  };

  const checkForkPermission = async (
    manifest: WorkflowManifest,
    parent: WorkspaceRecord,
    ctx: ExtensionContext,
  ): Promise<void> => {
    const panePolicy = process.env.PIZJ_CHILD_ID ? process.env.PIZJ_FORK_POLICY as ForkPolicy | undefined : undefined;
    const effectivePolicy = panePolicy ?? parent.forkPolicy;
    if (effectivePolicy === "deny") throw new Error("This assignment has forkPolicy=deny. Report the work to its parent.");
    if (effectivePolicy === "ask") {
      if (!ctx.hasUI || !await ctx.ui.confirm("Create a child workspace?", "The parent assignment requires approval for another workspace.")) {
        throw new Error("The child workspace was not approved");
      }
    }
    if (parent.depth + 1 > manifest.limits.maxDepth) throw new Error(`The workflow depth limit is ${manifest.limits.maxDepth}`);
    const active = manifest.workspaces.filter((workspace) => workspace.state === "active" || workspace.state === "reported");
    if (active.length >= manifest.limits.maxWorkspaceTabs) throw new Error(`The workflow tab limit is ${manifest.limits.maxWorkspaceTabs}`);
    if (parent.depth > 0) {
      const children = active.filter((workspace) => workspace.parentWorkspaceId === parent.id);
      if (children.length >= manifest.limits.maxChildTabsPerNonRoot) {
        throw new Error(`A non-root tab can create ${manifest.limits.maxChildTabsPerNonRoot} child tabs`);
      }
    }
  };

  const forkSource = (ctx: ExtensionContext): string | undefined => {
    const source = ctx.sessionManager.getSessionFile();
    if (!source) return undefined;
    const userEntry = [...ctx.sessionManager.getBranch()].reverse().find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    if (!userEntry) return source;
    const branch = ctx.sessionManager.getBranch().slice(0, ctx.sessionManager.getBranch().findIndex((entry) => entry.id === userEntry.id) + 1);
    if (!branch.some((entry) => entry.type === "message" && entry.message.role === "assistant")) return undefined;
    return SessionManager.open(source).createBranchedSession(userEntry.id) ?? source;
  };

  const piCommand = (
    sessionFile: string | undefined,
    prompt: string,
    model?: string,
    thinkingLevel?: string,
    tools?: string[],
    approveProject = false,
  ): string[] => {
    const args = ["pi", approveProject ? "--approve" : "--no-approve"];
    if (sessionFile) args.push("--fork", sessionFile);
    if (model) args.push("--model", model);
    if (thinkingLevel) args.push("--thinking", thinkingLevel);
    if (tools?.length) args.push("--tools", tools.join(","));
    args.push(prompt);
    return args;
  };

  const childEnvironment = (
    manifest: WorkflowManifest,
    childId: string,
    parentWorkspace: WorkspaceRecord,
    label: string,
    forkPolicy: ForkPolicy,
  ): Record<string, string> => ({
    PIZJ: "1",
    PIZJ_WORKFLOW_ID: manifest.id,
    PIZJ_CHILD_ID: childId,
    PIZJ_PARENT_WORKSPACE_ID: parentWorkspace.id,
    PIZJ_RESULT_FILE: getResultPath(manifest.id, childId),
    PIZJ_LABEL: label,
    PIZJ_FORK_POLICY: forkPolicy,
  });

  const waitForChild = async (manifest: WorkflowManifest, childId: string, minutes: number, signal?: AbortSignal): Promise<ChildResult> =>
    waitFor(() => readResult<ChildResult>(getResultPath(manifest.id, childId)), minutes * 60_000, signal);

  const childOutput = (result: ChildResult): string => {
    if (result.stopReason === "error" || result.stopReason === "aborted" || result.stopReason === "length") {
      throw new Error(`The child agent stopped with ${result.stopReason}: ${result.text || "no report"}`);
    }
    const truncated = truncateHead(result.text || "(no report)");
    return truncated.truncated ? `${truncated.content}\n\n[Child report truncated.]` : truncated.content;
  };

  pi.registerFlag("pizj", { description: "Enable pizj orchestration", type: "boolean", default: false });

  pi.registerCommand("pizj", {
    description: "Control pizj: on, off, status, or done",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "on") {
        const manifest = await ensureWorkflow(ctx);
        setMode(true, ctx);
        ctx.ui.notify(`pizj enabled: ${manifest.id}`, "info");
      } else if (action === "off") {
        setMode(false, ctx);
        ctx.ui.notify("pizj disabled. Existing panes and tabs remain open.", "info");
      } else if (action === "status") {
        if (!currentWorkflowId) ctx.ui.notify(`pizj is ${enabled ? "on" : "off"}`, "info");
        else ctx.ui.notify(formatWorkflow(await readWorkflow(currentWorkflowId)), "info");
      } else if (action === "done") {
        if (!currentWorkflowId) return;
        let manifest = await readWorkflow(currentWorkflowId);
        requireOwner(manifest, ctx);
        manifest = await updateWorkflow(manifest.id, (next) => {
          if (next.state === "finished") throw new Error("The pizj workflow is finished");
          const cutoff = Date.now() - 120_000;
          const recentPane = next.panes.find((pane) => pane.id.startsWith("pending-") && Date.parse(pane.createdAt) > cutoff);
          const recentWorkspace = next.workspaces.find((workspace) => workspace.repositoryId === "pending" && Date.parse(workspace.createdAt) > cutoff);
          if (recentPane || recentWorkspace) throw new Error("Wait for pending pizj launches before finishing the workflow");
          next.panes = next.panes.filter((pane) => !pane.id.startsWith("pending-"));
          next.workspaces = next.workspaces.filter((workspace) => workspace.repositoryId !== "pending");
          next.state = "finishing";
        });
        for (const pane of manifest.panes.filter((item) => item.state === "active" || item.state === "reported")) {
          await closePane(run, manifest.zellijSession, pane.id).catch(() => undefined);
        }
        for (const workspace of [...manifest.workspaces].sort((a, b) => b.depth - a.depth)) {
          if (workspace.kind !== "root" && workspace.state !== "removed" && workspace.state !== "closed") {
            await closeTab(run, manifest.zellijSession, workspace.tabId).catch(() => undefined);
          }
        }
        await updateWorkflow(manifest.id, (next) => {
          next.state = "finished";
          next.panes.forEach((pane) => { if (pane.state === "active" || pane.state === "reported") pane.state = "closed"; });
          next.workspaces.forEach((workspace) => {
            if (workspace.kind !== "root" && (workspace.state === "active" || workspace.state === "reported")) workspace.state = "closed";
          });
        });
        setMode(false, ctx);
        ctx.ui.notify("pizj child panes and tabs closed. Workspace directories remain until integration or removal.", "info");
      } else {
        ctx.ui.notify("Usage: /pizj on|off|status|done", "error");
      }
    },
  });

  pi.registerCommand("agents", {
    description: "Show pizj subagents in this workflow",
    handler: async (_args, ctx) => {
      if (!currentWorkflowId) return ctx.ui.notify("No pizj workflow", "info");
      const manifest = await readWorkflow(currentWorkflowId);
      const lines = manifest.panes.map((pane) => `${pane.id} ${pane.agent} ${pane.state} ${pane.label}`);
      ctx.ui.notify(lines.join("\n") || "No subagents", "info");
    },
  });

  pi.registerCommand("agent-close", {
    description: "Close an owned pizj subagent pane: <pane-id>",
    handler: async (args, ctx) => {
      if (!currentWorkflowId) return ctx.ui.notify("No pizj workflow", "info");
      const id = args.trim().replace(/^terminal_/, "");
      const manifest = await readWorkflow(currentWorkflowId);
      const pane = manifest.panes.find((item) => item.id === id);
      if (!pane) return ctx.ui.notify(`Unknown pizj pane: ${id}`, "error");
      const ownsPane = pane.parentPaneId === currentPaneId || manifest.ownerSessionId === ctx.sessionManager.getSessionId();
      if (!ownsPane) return ctx.ui.notify("This Pi session does not own that pane", "error");
      await closePane(run, manifest.zellijSession, pane.id);
      await updateWorkflow(manifest.id, (next) => { next.panes.find((item) => item.id === id)!.state = "closed"; });
      ctx.ui.notify(`Closed pane ${id}`, "info");
    },
  });

  pi.registerCommand("workflows", {
    description: "Show all known pizj workflows",
    handler: async (_args, ctx) => ctx.ui.notify((await listWorkflows()).map(formatWorkflow).join("\n") || "No workflows", "info"),
  });

  pi.registerCommand("workspace-new", {
    description: "Ask the coordinator to create a scoped pizj workspace",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) return ctx.ui.notify("Usage: /workspace-new <task>", "error");
      pi.sendUserMessage(`Use pizj_open_workspace for this task if it needs an isolated modifying workspace. Ask for any missing repository, boundary, acceptance checks, or base revision first. Task: ${task}`);
    },
  });

  pi.registerCommand("workspace-list", {
    description: "Show workspaces in this pizj workflow",
    handler: async (_args, ctx) => {
      if (!currentWorkflowId) return ctx.ui.notify("No pizj workflow", "info");
      const manifest = await readWorkflow(currentWorkflowId);
      ctx.ui.notify(manifest.workspaces.map((workspace) =>
        `${workspace.id} ${workspace.state} depth=${workspace.depth} ${workspace.path}`).join("\n"), "info");
    },
  });

  pi.registerTool({
    name: "pizj_delegate",
    label: "Pizj Delegate",
    description: "Run a read-only scout, researcher, planner, reviewer, or debugger in a background stacked pane in this tab. The pane closes after the agent reports. All panes use this tab's jj workspace. Use Luna for information or summaries, Terra for analysis or source explanations, and Sol for decisions, difficult coding, or deep analysis. Escalate the tier or thinking level after an unsatisfactory result. Avoid fan-out when the current agent can do the work directly.",
    parameters: Type.Object({
      agent: StringEnum(["scout", "researcher", "planner", "reviewer", "debugger"] as const),
      task: Type.String(),
      model: Type.Optional(Type.String()),
      thinkingLevel: Type.Optional(ThinkingSchema),
      forkPolicy: Type.Optional(ForkPolicySchema),
      assignment: Type.Optional(Type.String()),
      timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
    }),
    async execute(_id, params, signal, update, ctx) {
      if (!enabled) throw new Error("Enable pizj with /pizj on");
      const manifest = await ensureWorkflow(ctx);
      const parent = workspaceFor(manifest, ctx.cwd);
      const profile = (await loadAgents()).find((agent) => agent.name === params.agent);
      if (!profile) throw new Error(`Unknown pizj agent: ${params.agent}`);
      const policy = params.forkPolicy ?? "deny";
      const selectedModel = normalizeModel(params.model ?? profile.model);
      validateModel(params.agent, selectedModel);
      const childId = `${manifest.id}-${params.agent}-${shortId()}`;
      const label = `${params.agent}: ${slugify(params.task).slice(0, 24)}`;
      const tools = [...profile.tools];
      tools.push("pizj_delegate");
      if (policy !== "deny") tools.push("pizj_open_workspace", "pizj_wait_workspace");
      const resultFile = getResultPath(manifest.id, childId);
      const startedFile = `${resultFile}.started`;
      const launchFile = `${resultFile}.launch.json`;
      await updateWorkflow(manifest.id, (next) => {
        if (next.state !== "active") throw new Error(`The pizj workflow is ${next.state}`);
        const count = next.panes.filter((pane) => pane.tabId === parent.tabId && (pane.state === "active" || pane.state === "reported")).length;
        if (count >= next.limits.maxSubagentsPerTab) throw new Error(`The tab subagent limit is ${next.limits.maxSubagentsPerTab}`);
        next.panes.push({
          id: `pending-${childId}`, tabId: parent.tabId, parentPaneId: currentPaneId, label, agent: params.agent,
          resultFile, state: "active", createdAt: new Date().toISOString(),
        });
      });
      let pane: string;
      try {
        if ((await readWorkflow(manifest.id)).state !== "active") throw new Error("The pizj workflow is finishing");
        const launch = await childLaunch(resultFile, {
          ...childEnvironment(manifest, childId, parent, label, policy),
          PIZJ_READ_ONLY: "1",
          PIZJ_STARTED_FILE: startedFile,
        }, piCommand(forkSource(ctx), childPrompt(profile, params.task, policy, params.assignment), selectedModel, params.thinkingLevel ?? profile.thinkingLevel, tools, ctx.isProjectTrusted()));
        pane = await withZellijLock(() => openStartedPane({
          session: manifest.zellijSession,
          tabId: parent.tabId,
          cwd: parent.path,
          label,
          environment: {},
          command: launch.command,
          nearCurrentPane: true,
        }, startedFile, signal));
        await updateWorkflow(manifest.id, (next) => { next.panes.find((item) => item.resultFile === resultFile)!.id = pane; });
        update?.({ content: [{ type: "text", text: `${params.agent} works in pane ${pane}: ${params.task}` }], details: undefined });
      } catch (error) {
        if (pane!) await closePane(run, manifest.zellijSession, pane).catch(() => undefined);
        await rm(startedFile, { force: true });
        await rm(launchFile, { force: true });
        await updateWorkflow(manifest.id, (next) => { next.panes = next.panes.filter((item) => item.resultFile !== resultFile); });
        throw error;
      }
      try {
        const result = await waitForChild(manifest, childId, params.timeoutMinutes ?? 30, signal);
        return { content: [{ type: "text", text: childOutput(result) }], details: result };
      } finally {
        await closePane(run, manifest.zellijSession, pane).catch(() => undefined);
        await rm(startedFile, { force: true });
        await rm(launchFile, { force: true });
        await updateWorkflow(manifest.id, (next) => {
          const item = next.panes.find((candidate) => candidate.resultFile === resultFile);
          if (item) item.state = "closed";
        });
      }
    },
    renderCall(args, theme) {
      const task = args.task.length > 80 ? `${args.task.slice(0, 80)}...` : args.task;
      return new Text(`${theme.fg("toolTitle", theme.bold("pizj delegate "))}${theme.fg("accent", args.agent)}\n  ${theme.fg("dim", task)}`, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const detail = result.details as ChildResult | undefined;
      const raw = detail?.text ?? (result.content[0]?.type === "text" ? result.content[0].text : "No agent response");
      const lines = raw.split("\n");
      const text = expanded || lines.length <= 4 ? raw : `${lines.slice(0, 4).join("\n")}\n${theme.fg("muted", "... expand for the full response")}`;
      const status = isPartial
        ? theme.fg("warning", "working")
        : detail?.stopReason && detail.stopReason !== "stop"
          ? theme.fg("error", detail.stopReason)
          : theme.fg("success", "complete");
      return new Text(`${status}\n${theme.fg("toolOutput", text)}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "pizj_open_workspace",
    label: "Pizj Open Workspace",
    description: "Start an independent modifying worker in a new jj workspace tab and return after startup. Open all independent workspaces before waiting for their results. The repository can be the current repo, another local repo, or a Git URL. Use Sol for difficult coding and decisions. Do not create a workspace when same-tab or sequential work is sufficient.",
    parameters: Type.Object({
      task: Type.String(),
      assignment: Type.String({ description: "Boundary, deliverable, acceptance checks, and expected revision output" }),
      repository: Type.Optional(Type.String()),
      baseRevision: Type.Optional(Type.String()),
      forkPolicy: Type.Optional(ForkPolicySchema),
      model: Type.Optional(Type.String()),
      thinkingLevel: Type.Optional(ThinkingSchema),
      timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
      waitForCompletion: Type.Optional(Type.Boolean({ description: "Wait for the worker report. Defaults to false so the parent can start all workspace tabs first." })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (!enabled) throw new Error("Enable pizj with /pizj on");
      const manifest = await ensureWorkflow(ctx);
      const parent = workspaceFor(manifest, ctx.cwd);
      await checkForkPermission(manifest, parent, ctx);
      const selectedModel = normalizeModel(params.model ?? "gpt-5.6-sol");
      validateModel("worker", selectedModel);
      const source = params.repository;
      const remote = Boolean(source && (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) || source.startsWith("git@")));
      if (remote && ctx.hasUI && !await ctx.ui.confirm("Clone repository?", source!)) throw new Error("Repository clone cancelled");
      const id = `${manifest.id}-workspace-${shortId()}`;
      const policy = params.forkPolicy ?? "deny";
      await updateWorkflow(manifest.id, (next) => {
        if (next.state !== "active") throw new Error(`The pizj workflow is ${next.state}`);
        const active = next.workspaces.filter((workspace) => workspace.state === "active" || workspace.state === "reported");
        if (active.length >= next.limits.maxWorkspaceTabs) throw new Error(`The workflow tab limit is ${next.limits.maxWorkspaceTabs}`);
        const children = active.filter((workspace) => workspace.parentWorkspaceId === parent.id);
        if (parent.depth > 0 && children.length >= next.limits.maxChildTabsPerNonRoot) {
          throw new Error(`A non-root tab can create ${next.limits.maxChildTabsPerNonRoot} child tabs`);
        }
        next.workspaces.push({
          id, kind: "jj-workspace", repositoryId: "pending", repositoryRoot: "", integrationPath: "",
          workspaceName: id, path: `/__pizj_pending__/${id}`, baseCommit: "", parentWorkspaceId: parent.id,
          parentPaneId: currentPaneId, tabId: -1, tabName: id, depth: parent.depth + 1, task: params.task,
          forkPolicy: policy, state: "active", createdAt: new Date().toISOString(),
        });
      });
      let created: Awaited<ReturnType<typeof createWorkspace>>;
      try {
        created = remote
          ? await cloneRepository(run, source!, params.task, params.baseRevision ?? "@-")
          : await createWorkspace(run, source ? resolve(ctx.cwd, source) : ctx.cwd, params.task, params.baseRevision ?? "trunk()");
      } catch (error) {
        await updateWorkflow(manifest.id, (next) => { next.workspaces = next.workspaces.filter((item) => item.id !== id); });
        throw error;
      }
      const tabName = tabLabel(remote ? source! : created.repository.root, params.task);
      const resultFile = getResultPath(manifest.id, id);
      const environment = childEnvironment(manifest, id, parent, tabName, policy);
      const startedFile = `${resultFile}.started`;
      const launchFile = `${resultFile}.launch.json`;
      environment.PIZJ_WORKSPACE_ID = id;
      environment.PIZJ_STARTED_FILE = startedFile;
      let tabId: number | undefined;
      let record: WorkspaceRecord | undefined;
      try {
        if ((await readWorkflow(manifest.id)).state !== "active") throw new Error("The pizj workflow is finishing");
        const launch = await childLaunch(resultFile, environment, piCommand(forkSource(ctx), workerPrompt(params.task, params.assignment, policy), selectedModel, params.thinkingLevel ?? "high", undefined, !source && ctx.isProjectTrusted()));
        await withZellijLock(async () => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            tabId = await openTab(run, {
              session: manifest.zellijSession,
              cwd: created.path,
              name: tabName,
              command: launch.command,
            });
            try {
              await waitFor(async () => access(startedFile).then(() => true).catch(() => undefined), attempt === 0 ? 2000 : 10_000, signal);
              break;
            } catch (error) {
              await closeTab(run, manifest.zellijSession, tabId).catch(() => undefined);
              await rm(startedFile, { force: true });
              if (signal?.aborted || attempt === 1) throw new Error(`The Zellij tab process did not start: ${String(error)}`);
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
            }
          }
        });
        if (tabId === undefined) throw new Error("Zellij did not return a workspace tab ID");
        record = {
          id,
          kind: remote ? "clone" : "jj-workspace",
          repositoryId: created.repository.id,
          repositoryRoot: created.repository.root,
          integrationPath: remote ? created.path : created.repository.root,
          remoteUrl: created.repository.remoteUrl,
          workspaceName: created.name,
          path: created.path,
          baseCommit: created.base.commitId,
          parentWorkspaceId: parent.id,
          parentPaneId: currentPaneId,
          tabId,
          tabName,
          depth: parent.depth + 1,
          task: params.task,
          forkPolicy: policy,
          state: "active",
          createdAt: new Date().toISOString(),
        };
        await updateWorkflow(manifest.id, (next) => {
          const reserved = next.workspaces.find((item) => item.id === id);
          if (!reserved) throw new Error(`The workspace reservation disappeared: ${id}`);
          Object.assign(reserved, record);
        });
      } catch (error) {
        if (tabId !== undefined) await closeTab(run, manifest.zellijSession, tabId).catch(() => undefined);
        await updateWorkflow(manifest.id, (next) => { next.workspaces = next.workspaces.filter((item) => item.id !== id); });
        if (!remote) await forgetWorkspace(run, created.repository.root, created.name).catch(() => undefined);
        await rm(created.path, { recursive: true, force: true });
        await rm(startedFile, { force: true });
        await rm(launchFile, { force: true });
        throw error;
      }
      await rm(startedFile, { force: true });
      await rm(launchFile, { force: true });
      if (!params.waitForCompletion) {
        const text = `Started workspace ${id}\npath=${created.path}\ntab=${tabName}`;
        return { content: [{ type: "text", text }], details: { workspace: record, state: "active" } };
      }
      const result = await waitForChild(manifest, id, params.timeoutMinutes ?? 60, signal);
      return { content: [{ type: "text", text: `workspace=${created.path}\n${childOutput(result)}` }], details: { workspace: record, result } };
    },
  });

  pi.registerTool({
    name: "pizj_wait_workspace",
    label: "Pizj Wait Workspace",
    description: "Wait for a started workspace worker and return its report. Start all independent workspace workers before waiting.",
    parameters: Type.Object({
      workspaceId: Type.String(),
      timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
    }),
    async execute(_id, params, signal, _update, _ctx) {
      if (!enabled || !currentWorkflowId) throw new Error("No active pizj workflow");
      const manifest = await readWorkflow(currentWorkflowId);
      const workspace = manifest.workspaces.find((item) => item.id === params.workspaceId && item.kind !== "root");
      if (!workspace) throw new Error(`Unknown child workspace: ${params.workspaceId}`);
      const result = await waitForChild(manifest, workspace.id, params.timeoutMinutes ?? 60, signal);
      return { content: [{ type: "text", text: `workspace=${workspace.path}\n${childOutput(result)}` }], details: { workspace, result } };
    },
  });

  const integrate = async (workspaceId: string, destination: string, ctx: ExtensionContext): Promise<string> => {
    if (!currentWorkflowId) throw new Error("No pizj workflow");
    const initialManifest = await readWorkflow(currentWorkflowId);
    requireOwner(initialManifest, ctx);
    const initialWorkspace = initialManifest.workspaces.find((item) => item.id === workspaceId);
    if (!initialWorkspace) throw new Error(`Unknown child workspace: ${workspaceId}`);
    const lockId = `integrate-${createHash("sha256").update(initialWorkspace.repositoryId).digest("hex").slice(0, 16)}`;
    return withStateLock(lockId, async () => {
    const manifest = await readWorkflow(currentWorkflowId!);
    const workspace = manifest.workspaces.find((item) => item.id === workspaceId);
    if (!workspace || workspace.kind === "root") throw new Error(`Unknown child workspace: ${workspaceId}`);
    if (workspace.state === "active") throw new Error(`Workspace ${workspaceId} is still active. Wait for its report before integration.`);
    const children = manifest.workspaces.filter((item) => item.parentWorkspaceId === workspace.id && !["integrated", "removed"].includes(item.state));
    if (children.length) throw new Error(`Integrate child workspaces first: ${children.map((item) => item.id).join(", ")}`);
    await closeTab(run, manifest.zellijSession, workspace.tabId);
    await updateWorkflow(manifest.id, (next) => { next.workspaces.find((item) => item.id === workspace.id)!.state = "closed"; });
    const revisions = await revisionRange(run, workspace.path, workspace.baseCommit);
    const summary = revisions.map((revision) => revision.changeId.slice(0, 12)).join(", ") || "none";
    if (!ctx.hasUI || !await ctx.ui.confirm("Integrate jj revisions?", `${summary}\nRepository: ${workspace.integrationPath}\nInsert before the current integration working copy`)) {
      throw new Error("Integration was not approved");
    }
    const integrationHead = await snapshotRevision(run, workspace.integrationPath, "@");
    const destinationRevision = destination === "@" ? integrationHead : await resolveRevision(run, workspace.integrationPath, destination);
    if (destinationRevision.commitId !== integrationHead.commitId) {
      throw new Error("The integration destination must resolve to the integration workspace's current @ revision");
    }
    if (workspace.kind === "clone") {
      await updateWorkflow(manifest.id, (next) => {
        const item = next.workspaces.find((candidate) => candidate.id === workspace.id)!;
        item.state = "integrated";
        item.changeIds = revisions.map((revision) => revision.changeId);
        item.headCommit = revisions.at(0)?.commitId;
      });
      return "The cloned repository tab is its integration workspace. Its revisions are ready without a rebase.";
    }
    await forgetWorkspace(run, workspace.integrationPath, workspace.workspaceName);
    try {
      await rebaseRevisions(run, workspace.integrationPath, revisions.map((revision) => revision.commitId), destinationRevision.commitId);
    } catch (error) {
      const sourceHead = revisions.at(0)?.commitId;
      if (sourceHead) await restoreWorkspace(run, workspace.integrationPath, workspace.workspaceName, workspace.path, sourceHead);
      await updateWorkflow(manifest.id, (next) => { next.workspaces.find((item) => item.id === workspace.id)!.state = "failed"; });
      throw error;
    }
    await updateWorkflow(manifest.id, (next) => {
      const item = next.workspaces.find((candidate) => candidate.id === workspace.id)!;
      item.state = "integrated";
      item.changeIds = revisions.map((revision) => revision.changeId);
      item.headCommit = revisions.at(0)?.commitId;
    });
    await rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
    return `Integrated ${revisions.length} revision(s) from ${workspace.id} before the integration working copy`;
    });
  };

  pi.registerTool({
    name: "pizj_integrate",
    label: "Pizj Integrate",
    description: "After child agents stop, review and execute an approved jj rebase into the repository's integration workspace. Integrate descendants first.",
    parameters: Type.Object({ workspaceId: Type.String(), destination: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, ctx) {
      const text = await integrate(params.workspaceId, params.destination ?? "@", ctx);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  const removeWorkspace = async (workspaceId: string, ctx: ExtensionContext): Promise<string> => {
    if (!currentWorkflowId) throw new Error("No pizj workflow");
    const manifest = await readWorkflow(currentWorkflowId);
    requireOwner(manifest, ctx);
    const workspace = manifest.workspaces.find((item) => item.id === workspaceId);
    if (!workspace || workspace.kind === "root") throw new Error(`Unknown child workspace: ${workspaceId}`);
    const children = manifest.workspaces.filter((item) => item.parentWorkspaceId === workspace.id && !["integrated", "removed"].includes(item.state));
    if (children.length) throw new Error(`Remove child workspaces first: ${children.map((item) => item.id).join(", ")}`);
    if (workspace.kind === "clone" && workspace.state === "integrated") {
      throw new Error(`Pizj will not delete an integrated clone because it may contain unpublished revisions. Verify publication, then remove it manually: ${workspace.path}`);
    }
    if (!ctx.hasUI || !await ctx.ui.confirm("Remove workspace without integration?", workspace.path)) throw new Error("Workspace removal cancelled");
    await closeTab(run, manifest.zellijSession, workspace.tabId);
    if (workspace.kind === "jj-workspace") await forgetWorkspace(run, workspace.integrationPath, workspace.workspaceName);
    await updateWorkflow(manifest.id, (next) => { next.workspaces.find((item) => item.id === workspace.id)!.state = "removed"; });
    await rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
    return `Removed ${workspace.path}`;
  };

  pi.registerTool({
    name: "pizj_remove_workspace",
    label: "Pizj Remove Workspace",
    description: "Close and remove an owned workspace after explicit confirmation, without integrating its revisions.",
    parameters: Type.Object({ workspaceId: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      const text = await removeWorkspace(params.workspaceId, ctx);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerCommand("workspace-integrate", {
    description: "Integrate a pizj workspace: <id> [destination]",
    handler: async (args, ctx) => {
      const [id, destination = "@"] = args.trim().split(/\s+/);
      if (!id) return ctx.ui.notify("Usage: /workspace-integrate <id> [destination]", "error");
      try { ctx.ui.notify(await integrate(id, destination, ctx), "info"); } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });

  pi.registerCommand("workspace-remove", {
    description: "Remove a pizj workspace without integration: <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) return ctx.ui.notify("Usage: /workspace-remove <id>", "error");
      try { ctx.ui.notify(await removeWorkspace(id, ctx), "info"); } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n[PIZJ MODE]\nUse pizj tools for delegation. Do not call tools from another subagent plugin. Use Luna only for information and summaries without analysis. Use Terra for analysis and source explanations without decisions. Use Sol for decisions, difficult coding, and deep analysis. Increase the model tier or thinking level after an unsatisfactory result.`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (enabled && isOtherSubagentTool(event.toolName)) {
      return { block: true, reason: "Use pizj tools instead of another subagent plugin while pizj mode is active." };
    }
    if (process.env.PIZJ_READ_ONLY !== "1" || event.toolName !== "bash") return;
    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string" || !isReadOnlyCommand(command)) {
      return { block: true, reason: "This pizj subagent has a read-only shell policy. Report modifying work to the parent." };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const persisted = [...ctx.sessionManager.getEntries()].reverse().find(
      (entry) => entry.type === "custom" && entry.customType === "pizj-mode",
    );
    const state = persisted?.type === "custom" ? persisted.data as { enabled?: boolean; workflowId?: string } | undefined : undefined;
    currentWorkflowId ??= state?.workflowId;
    enabled = process.env.PIZJ === "1" || pi.getFlag("pizj") === true || state?.enabled === true;
    if (enabled && !currentWorkflowId) await ensureWorkflow(ctx);
    setMode(enabled, ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const childId = process.env.PIZJ_CHILD_ID;
    const resultFile = process.env.PIZJ_RESULT_FILE;
    if (!childId || !resultFile || !currentWorkflowId) return;
    const message = lastAssistant(ctx);
    let revisions: Array<{ commitId: string; changeId: string }> | undefined;
    const workspaceId = process.env.PIZJ_WORKSPACE_ID;
    if (workspaceId) {
      const manifest = await readWorkflow(currentWorkflowId);
      const workspace = manifest.workspaces.find((item) => item.id === workspaceId);
      if (workspace) revisions = await revisionRange(run, workspace.path, workspace.baseCommit).catch(() => undefined);
    }
    await writeResult(resultFile, {
      childId,
      sessionFile: ctx.sessionManager.getSessionFile(),
      text: textOf(message),
      stopReason: message?.stopReason,
      revisions,
    } satisfies ChildResult);
    await updateWorkflow(currentWorkflowId, (manifest) => {
      const pane = manifest.panes.find((item) => item.resultFile === resultFile);
      if (pane && pane.state === "active") {
        pane.state = "reported";
        pane.sessionFile = ctx.sessionManager.getSessionFile();
      }
      const workspace = manifest.workspaces.find((item) => item.id === workspaceId);
      if (workspace && (workspace.state === "active" || workspace.state === "reported")) {
        workspace.state = "reported";
        workspace.changeIds = revisions?.map((revision) => revision.changeId);
        workspace.headCommit = revisions?.at(0)?.commitId;
      }
    });
  });
};
