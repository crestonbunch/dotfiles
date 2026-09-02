import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("workflow locks serialize concurrent actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pizj-store-test-"));
  process.env.PIZJ_STATE_DIR = root;
  const { withStateLock } = await import("../extensions/store.ts");
  let active = 0;
  let maximum = 0;

  const action = async (): Promise<void> => withStateLock("shared", async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  });

  try {
    await Promise.all([action(), action(), action()]);
    assert.equal(maximum, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
