export type ForkPolicy = "deny" | "ask" | "allow";
export type WorkspaceKind = "root" | "jj-workspace" | "clone";
export type ResourceState = "active" | "reported" | "closed" | "integrated" | "removed" | "failed";

export interface Limits {
  maxDepth: number;
  maxWorkspaceTabs: number;
  maxSubagentsPerTab: number;
  maxChildTabsPerNonRoot: number;
}

export interface PaneRecord {
  id: string;
  tabId: number;
  parentPaneId: string;
  label: string;
  agent: string;
  sessionFile?: string;
  resultFile: string;
  state: ResourceState;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  kind: WorkspaceKind;
  repositoryId: string;
  repositoryRoot: string;
  integrationPath: string;
  remoteUrl?: string;
  workspaceName: string;
  path: string;
  baseCommit: string;
  headCommit?: string;
  changeIds?: string[];
  parentWorkspaceId?: string;
  parentPaneId: string;
  tabId: number;
  tabName: string;
  depth: number;
  task: string;
  forkPolicy: ForkPolicy;
  state: ResourceState;
  createdAt: string;
}

export interface WorkflowManifest {
  version: 1;
  id: string;
  ownerSessionId: string;
  zellijSession: string;
  rootPaneId: string;
  rootWorkspaceId: string;
  state: "active" | "finishing" | "finished";
  limits: Limits;
  workspaces: WorkspaceRecord[];
  panes: PaneRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
) => Promise<CommandResult>;
