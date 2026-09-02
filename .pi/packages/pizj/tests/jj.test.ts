import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import type { RunCommand } from "../extensions/types.ts";

const run: RunCommand = async (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const command = async (args: string[], cwd?: string): Promise<void> => {
  const result = await run("jj", args, { cwd });
  assert.equal(result.code, 0, result.stderr);
};

test("a workspace reports revisions above its fixed base", async () => {
  const root = await mkdtemp(join(tmpdir(), "pizj-jj-test-"));
  process.env.PIZJ_WORKSPACE_DIR = join(root, "workspaces");
  const repository = join(root, "repository");

  try {
    await command(["git", "init", repository]);
    const { createWorkspace, forgetWorkspace, rebaseRevisions, resolveRevision, revisionRange } = await import("../extensions/jj.ts");
    const created = await createWorkspace(run, repository, "Add fixture", "@");
    await writeFile(join(created.path, "fixture.txt"), "fixture\n");
    await command(["describe", "-m", "Add fixture"], created.path);

    const revisions = await revisionRange(run, created.path, created.base.commitId);

    assert.equal(revisions.length, 1);
    assert.ok(revisions[0].changeId);

    const integrationHead = await resolveRevision(run, repository, "@");
    await forgetWorkspace(run, repository, created.name);
    await rebaseRevisions(run, repository, [revisions[0].commitId], integrationHead.commitId);
    const integratedParent = await resolveRevision(run, repository, "@-");

    assert.equal(integratedParent.changeId, revisions[0].changeId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
