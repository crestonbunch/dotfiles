import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitizeDisplayText, type WorkDirectory } from "./core.ts";

type Query = (command: string, args: string[], timeout?: number) => Promise<string | undefined>;

/** Missing tools, non-repositories and timeouts are normal absence. */
export const directoryQueries = (pi: ExtensionAPI, cwd: string, signal: AbortSignal): Query =>
  async (command, args, timeout = 2000) => {
    if (signal.aborted) return undefined;
    try {
      const result = await pi.exec(command, args, { cwd, signal, timeout });
      return result.code === 0 && !result.killed && result.stdout.length <= 64_000 ? result.stdout : undefined;
    } catch { return undefined; }
  };

export const discoverDirectory = async (query: Query, path: string, previous?: WorkDirectory): Promise<WorkDirectory> => {
  const jj = (args: string[]) => query("jj", ["--ignore-working-copy", "--no-pager", ...args]);
  const revision = await jj(["log", "--no-graph", "-r", "@", "-T", "change_id.shortest(8)"]);
  if (revision !== undefined) {
    const [bookmarks, root] = await Promise.all([jj(["bbt"]), jj(["workspace", "root"])]);
    const bookmark = bookmarks === undefined ? previous?.bookmark : sanitizeDisplayText(bookmarks.split("\n")[0] ?? "");
    return {
      path,
      revision: sanitizeDisplayText(revision).slice(0, 64) || undefined,
      bookmark: bookmark?.slice(0, 256) || undefined,
      workspace: root?.trim() ? "jj-workspace" : previous?.workspace === "jj-workspace" ? previous.workspace : undefined,
    };
  }
  const branch = await query("git", ["branch", "--show-current"]);
  if (branch === undefined) return previous ?? { path };
  const dirs = await query("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  const [gitDir, commonDir] = dirs?.trim().split("\n") ?? [];
  return {
    path,
    bookmark: sanitizeDisplayText(branch).slice(0, 256) || undefined,
    workspace: gitDir && commonDir ? gitDir !== commonDir ? "git-worktree" : undefined : previous?.workspace === "git-worktree" ? previous.workspace : undefined,
  };
};
