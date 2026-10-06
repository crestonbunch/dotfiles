import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseGithubRepositoryUrl, sanitizeDisplayText, type WorkDirectory } from "./core.ts";

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

// Both local commands list one remote URL per line; git adds fetch/push annotations.
const remoteMetadata = (output: string | undefined, previous?: WorkDirectory): Pick<WorkDirectory, "githubUrls"> => {
  if (output === undefined) return previous?.githubUrls?.length ? { githubUrls: previous.githubUrls } : {};
  const urls = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\S+[ \t]+(\S+)(?:[ \t]+\((?:fetch|push)\))?[ \t]*$/.exec(line);
    const repository = match && parseGithubRepositoryUrl(match[1]);
    if (repository) urls.add(repository.url);
    if (urls.size === 16) break;
  }
  return urls.size ? { githubUrls: [...urls] } : {};
};

export const discoverDirectory = async (query: Query, path: string, previous?: WorkDirectory): Promise<WorkDirectory> => {
  const jj = (args: string[]) => query("jj", ["--ignore-working-copy", "--no-pager", ...args]);
  const revision = await jj(["log", "--no-graph", "-r", "@", "-T", "change_id.shortest(8)"]);
  if (revision !== undefined) {
    const [bookmarks, root, remotes] = await Promise.all([jj(["bbt"]), jj(["workspace", "root"]), jj(["git", "remote", "list"])]);
    const bookmark = bookmarks === undefined ? previous?.bookmark : sanitizeDisplayText(bookmarks.split("\n")[0] ?? "");
    return {
      path,
      ...remoteMetadata(remotes, previous),
      revision: sanitizeDisplayText(revision).slice(0, 64) || undefined,
      bookmark: bookmark?.slice(0, 256) || undefined,
      workspace: root?.trim() ? "jj-workspace" : previous?.workspace === "jj-workspace" ? previous.workspace : undefined,
    };
  }
  const branch = await query("git", ["branch", "--show-current"]);
  if (branch === undefined) return previous ?? { path };
  const [dirs, remotes] = await Promise.all([
    query("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]),
    query("git", ["remote", "-v"]),
  ]);
  const [gitDir, commonDir] = dirs?.trim().split("\n") ?? [];
  return {
    path,
    ...remoteMetadata(remotes, previous),
    bookmark: sanitizeDisplayText(branch).slice(0, 256) || undefined,
    workspace: gitDir && commonDir ? gitDir !== commonDir ? "git-worktree" : undefined : previous?.workspace === "git-worktree" ? previous.workspace : undefined,
  };
};
