import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import type { RunCommand } from "./types.ts";

export const slugify = (value: string): string => {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 40) || "work";
};

export const tabLabel = (repository: string, task: string): string => {
  const repositoryTail = repository.replace(/\/+$/, "").split(/[/:]/).at(-1)?.replace(/\.git$/, "") ?? "repo";
  const repositoryPart = slugify(repositoryTail).slice(0, 18);
  const taskPart = slugify(task).slice(0, 36 - repositoryPart.length - 2);
  return `${repositoryPart}: ${taskPart}`;
};

export const shortId = (): string => randomBytes(6).toString("hex");

export const workflowId = (cwd: string, sessionId: string): string =>
  `${slugify(basename(cwd))}-${sessionId.slice(0, 8)}-${shortId()}`;

export const requireSuccess = async (
  run: RunCommand,
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
): Promise<string> => {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
};

export const waitFor = async <T>(
  read: () => Promise<T | undefined>,
  timeoutMilliseconds: number,
  signal?: AbortSignal,
): Promise<T> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("The child agent wait was cancelled");
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The child agent did not report before the timeout");
};
