import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const SNAPSHOT_EVENT = "work-context:snapshot:v1";
export const REQUEST_EVENT = "work-context:request:v1";
export const SELECTION_ENTRY = "work-context:selection:v1";
export const MAX_DIRECTORIES = 8;
export const MAX_PRS = 16;

export type WorkDirectory = {
  path: string;
  workspace?: "jj-workspace" | "git-worktree";
  revision?: string;
  bookmark?: string;
  githubUrls?: string[];
};
export type WorkPullRequest = { url: string; repo: string; number: number };
export type WorkContextSnapshot = {
  version: 1;
  sessionId: string;
  directories: WorkDirectory[];
  pullRequests: WorkPullRequest[];
};
export type Selection = { version: 1; directories?: string[]; prs?: string[] };
export type SelectionUpdate = { directories?: string[]; prs?: string[] };

const controls = /[\u0000-\u001f\u007f-\u009f]/;
export const sanitizeDisplayText = (text: string): string =>
  text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();

/** Local clone URLs become credential-free canonical repository hyperlinks. */
export const parseGithubRepositoryUrl = (input: string): { url: string; repo: string } | undefined => {
  if (typeof input !== "string" || input.length > 1024 || controls.test(input)) return undefined;
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::22)?\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/i.exec(input);
  if (!match) return undefined;
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, "");
  if (!name || [owner, name].some(part => part === "." || part === "..")) return undefined;
  const repo = `${owner}/${name}`.toLowerCase();
  return { url: `https://github.com/${repo}`, repo };
};

/** Only canonical GitHub PR URLs can become terminal hyperlinks. */
export const parsePullRequestUrl = (input: string): WorkPullRequest | undefined => {
  if (input.length > 1024 || controls.test(input)) return undefined;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(input);
  if (!match || [match[1], match[2]].some(part => part === "." || part === "..")) return undefined;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) return undefined;
  const repo = `${match[1]}/${match[2]}`.toLowerCase();
  return { url: `https://github.com/${repo}/pull/${number}`, repo, number };
};

const canonicalPath = (input: string, cwd: string): string => {
  if (!input || input.length > 2048 || controls.test(input)) throw new Error("Use a path without control characters (max 2048 characters).");
  if (input.startsWith("~") && input !== "~" && !input.startsWith("~/")) throw new Error("Use ~ or ~/path, not ~user paths.");
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? resolve(homedir(), input.slice(2)) : input;
  const path = resolve(cwd, expanded);
  try { return realpathSync(path); } catch { return path; }
};

const canonicalList = (items: string[], canonicalize: (item: string) => string, limit: number): string[] => {
  if (!Array.isArray(items) || items.some(item => typeof item !== "string")) throw new Error("Use arrays of strings.");
  if (items.length > limit) throw new Error(`Use at most ${limit} strings.`);
  return [...new Set(items.map(canonicalize))];
};

const canonicalPr = (url: string): string => {
  const pr = parsePullRequestUrl(url);
  if (!pr) throw new Error("Use canonical https://github.com/owner/repo/pull/number URLs without control characters.");
  return pr.url;
};

const retainList = (next: Selection, key: "directories" | "prs", items: string[]): void => {
  if (items.length) next[key] = items;
  else delete next[key];
};

/** Supplied arrays replace complete lists; omitted fields retain their registrations. */
export const updateSelection = (previous: Selection, update: SelectionUpdate, cwd: string): Selection => {
  const next: Selection = { ...previous };
  if (update.directories !== undefined) {
    retainList(next, "directories", canonicalList(update.directories, path => canonicalPath(path, cwd), MAX_DIRECTORIES));
  }
  if (update.prs !== undefined) {
    retainList(next, "prs", canonicalList(update.prs, canonicalPr, MAX_PRS));
  }
  return next;
};

/** Decode persisted selections independently of tool inputs; invalid entries never partially apply. */
export const restoreSelection = (data: unknown, cwd: string): Selection | undefined => {
  if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1) return undefined;
  const selection = data as Selection;
  try {
    const next: Selection = { version: 1 };
    retainList(next, "directories", canonicalList(selection.directories === undefined ? [] : selection.directories, path => canonicalPath(path, cwd), MAX_DIRECTORIES));
    retainList(next, "prs", canonicalList(selection.prs === undefined ? [] : selection.prs, canonicalPr, MAX_PRS));
    return next;
  } catch { return undefined; }
};
