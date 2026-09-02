import { access, cp, mkdir, realpath, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { RunCommand } from "./types.ts";
import { requireSuccess, shortId, slugify } from "./runtime.ts";

export interface RepositoryInfo {
  id: string;
  root: string;
  remoteUrl?: string;
}

export interface RevisionInfo {
  commitId: string;
  changeId: string;
}

const workspaceRoot = process.env.PIZJ_WORKSPACE_DIR ?? join(homedir(), ".workspaces");

const repoStorePath = async (root: string): Promise<string> => {
  const marker = join(root, ".jj", "repo");
  const markerStat = await stat(marker);
  if (markerStat.isDirectory()) return realpath(marker);
  const target = (await readFile(marker, "utf8")).trim();
  return realpath(resolve(join(root, ".jj"), target));
};

const remoteUrl = async (run: RunCommand, root: string): Promise<string | undefined> => {
  const result = await run("jj", ["git", "remote", "list"], { cwd: root, timeout: 5000 });
  if (result.code !== 0) return undefined;
  const first = result.stdout.split("\n").map((line) => line.trim()).find(Boolean);
  if (!first) return undefined;
  const separator = first.indexOf(" ");
  return separator < 0 ? undefined : first.slice(separator + 1).trim();
};

export const inspectRepository = async (run: RunCommand, cwd: string): Promise<RepositoryInfo> => {
  const root = await requireSuccess(run, "jj", ["root"], { cwd, timeout: 5000 });
  return { id: await repoStorePath(root), root, remoteUrl: await remoteUrl(run, root) };
};

const parseRevision = (output: string, revision: string): RevisionInfo => {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error(`The base revision must select one revision: ${revision}`);
  const [commitId, changeId] = lines[0].split("|");
  if (!commitId || !changeId) throw new Error(`Cannot parse revision: ${revision}`);
  return { commitId, changeId };
};

export const resolveRevision = async (run: RunCommand, cwd: string, revision: string): Promise<RevisionInfo> => {
  const output = await requireSuccess(run, "jj", [
    "--ignore-working-copy", "--no-pager", "log", "-r", revision, "--no-graph",
    "-T", 'commit_id ++ "|" ++ change_id ++ "\\n"',
  ], { cwd, timeout: 5000 });
  return parseRevision(output, revision);
};

export const snapshotRevision = async (run: RunCommand, cwd: string, revision: string): Promise<RevisionInfo> => {
  const output = await requireSuccess(run, "jj", [
    "--no-pager", "log", "-r", revision, "--no-graph",
    "-T", 'commit_id ++ "|" ++ change_id ++ "\\n"',
  ], { cwd, timeout: 5000 });
  return parseRevision(output, revision);
};

const availablePath = async (repoName: string, task: string): Promise<{ name: string; path: string }> => {
  await mkdir(workspaceRoot, { recursive: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = shortId();
    const name = `${slugify(repoName)}-${slugify(task)}-${suffix}`;
    const path = join(workspaceRoot, name);
    try {
      await access(path);
    } catch {
      return { name, path };
    }
  }
  throw new Error("Cannot allocate a unique pizj workspace path");
};

export const createWorkspace = async (
  run: RunCommand,
  repositoryPath: string,
  task: string,
  baseRevision: string,
): Promise<{ repository: RepositoryInfo; name: string; path: string; base: RevisionInfo }> => {
  const repository = await inspectRepository(run, repositoryPath);
  const base = await resolveRevision(run, repository.root, baseRevision);
  const destination = await availablePath(basename(repository.root), task);
  await requireSuccess(run, "jj", [
    "workspace", "add", "--name", destination.name, "-r", base.commitId, "-m", task, destination.path,
  ], { cwd: repository.root, timeout: 30_000 });
  return { repository, ...destination, base };
};

export const cloneRepository = async (
  run: RunCommand,
  source: string,
  task: string,
  baseRevision = "@-",
): Promise<{ repository: RepositoryInfo; name: string; path: string; base: RevisionInfo }> => {
  const sourceName = basename(source.replace(/\.git$/, ""));
  const destination = await availablePath(sourceName, task);
  await requireSuccess(run, "jj", ["git", "clone", source, destination.path], { timeout: 120_000 });
  const repository = await inspectRepository(run, destination.path);
  if (baseRevision !== "@-") {
    await requireSuccess(run, "jj", ["new", baseRevision], { cwd: destination.path, timeout: 10_000 });
  }
  const base = await resolveRevision(run, destination.path, baseRevision === "@-" ? "@-" : baseRevision);
  return { repository, ...destination, base };
};

export const revisionRange = async (
  run: RunCommand,
  workspacePath: string,
  baseCommit: string,
): Promise<RevisionInfo[]> => {
  const output = await requireSuccess(run, "jj", [
    "--no-pager", "log", "-r", `${baseCommit}..@`, "--no-graph",
    "-T", 'commit_id ++ "|" ++ change_id ++ "\\n"',
  ], { cwd: workspacePath, timeout: 5000 });
  return output.split("\n").filter(Boolean).map((line) => {
    const [commitId, changeId] = line.split("|");
    return { commitId, changeId };
  });
};

export const forgetWorkspace = async (
  run: RunCommand,
  integrationPath: string,
  workspaceName: string,
): Promise<void> => {
  await requireSuccess(run, "jj", ["--ignore-working-copy", "workspace", "forget", workspaceName], {
    cwd: integrationPath,
    timeout: 10_000,
  });
};

export const restoreWorkspace = async (
  run: RunCommand,
  integrationPath: string,
  workspaceName: string,
  workspacePath: string,
  revision: string,
): Promise<void> => {
  const backupPath = `${workspacePath}.pizj-backup-${process.pid}`;
  await rename(workspacePath, backupPath);
  try {
    await requireSuccess(run, "jj", ["workspace", "add", "--name", workspaceName, "-r", revision, workspacePath], {
      cwd: integrationPath,
      timeout: 30_000,
    });
    await rm(join(backupPath, ".jj"), { recursive: true, force: true });
    await cp(join(workspacePath, ".jj"), join(backupPath, ".jj"), { recursive: true });
    await rm(workspacePath, { recursive: true, force: true });
    await rename(backupPath, workspacePath);
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    await rename(backupPath, workspacePath).catch(() => undefined);
    throw error;
  }
};

export const rebaseRevisions = async (
  run: RunCommand,
  integrationPath: string,
  revisions: string[],
  destination: string,
): Promise<void> => {
  if (revisions.length === 0) throw new Error("The workspace has no revisions to integrate");
  const revset = revisions.join("|");
  await requireSuccess(run, "jj", ["rebase", "-r", revset, "-B", destination], {
    cwd: integrationPath,
    timeout: 60_000,
  });
};
