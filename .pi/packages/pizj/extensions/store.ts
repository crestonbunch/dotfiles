import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkflowManifest } from "./types.ts";

const stateRoot = process.env.PIZJ_STATE_DIR ?? join(homedir(), ".local", "state", "pizj");
const workflowDir = join(stateRoot, "workflows");

export const getStateRoot = (): string => stateRoot;
export const getWorkflowPath = (id: string): string => join(workflowDir, `${id}.json`);
export const getResultPath = (workflowId: string, childId: string): string =>
  join(stateRoot, "results", workflowId, `${childId}.json`);

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const withStateLock = async <T>(id: string, action: () => Promise<T>): Promise<T> => {
  const lock = join(workflowDir, `${id}.lock`);
  const ownerText = `${process.pid}:${Date.now()}`;
  await mkdir(workflowDir, { recursive: true });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      await writeFile(lock, ownerText, { flag: "wx", mode: 0o600 });
      try {
        return await action();
      } finally {
        if (await readFile(lock, "utf8").catch(() => "") === ownerText) await rm(lock, { force: true });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const observed = await readFile(lock, "utf8").catch(() => "");
      const owner = Number.parseInt(observed.split(":")[0] ?? "", 10);
      let stale = false;
      if (Number.isFinite(owner)) {
        try { process.kill(owner, 0); } catch (ownerError) { stale = (ownerError as NodeJS.ErrnoException).code === "ESRCH"; }
      } else {
        const info = await stat(lock).catch(() => undefined);
        stale = info === undefined || Date.now() - info.mtimeMs > 1000;
      }
      if (stale && await readFile(lock, "utf8").catch(() => "") === observed) {
        await rm(lock, { force: true });
        continue;
      }
      await sleep(Math.min(250, 10 + attempt * 5));
    }
  }
  throw new Error(`Timed out while waiting for the pizj workflow lock: ${id}`);
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
};

export const readWorkflow = async (id: string): Promise<WorkflowManifest> =>
  JSON.parse(await readFile(getWorkflowPath(id), "utf8")) as WorkflowManifest;

export const saveWorkflow = async (manifest: WorkflowManifest): Promise<void> => {
  await writeJson(getWorkflowPath(manifest.id), manifest);
};

export const updateWorkflow = async (
  id: string,
  update: (manifest: WorkflowManifest) => void,
): Promise<WorkflowManifest> =>
  withStateLock(id, async () => {
    const manifest = await readWorkflow(id);
    update(manifest);
    manifest.updatedAt = new Date().toISOString();
    await writeJson(getWorkflowPath(id), manifest);
    return manifest;
  });

export const writeResult = async (path: string, value: unknown): Promise<void> => writeJson(path, value);

export const readResult = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

export const listWorkflows = async (): Promise<WorkflowManifest[]> => {
  await mkdir(workflowDir, { recursive: true });
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(workflowDir)).filter((name) => name.endsWith(".json"));
  const manifests = await Promise.all(names.map((name) => readWorkflow(name.slice(0, -5))));
  return manifests.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};
