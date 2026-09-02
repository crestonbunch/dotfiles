import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const packageRoot = join(import.meta.dirname, "..");

test("a child exit without a report creates an error result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pizj-child-runner-test-"));
  const resultFile = join(directory, "result.json");
  const startedFile = join(directory, "started");
  const launchFile = join(directory, "launch.json");

  try {
    await writeFile(launchFile, JSON.stringify({
      environment: {
        PIZJ_CHILD_ID: "test-child",
        PIZJ_RESULT_FILE: resultFile,
        PIZJ_STARTED_FILE: startedFile,
      },
      command: [process.execPath, "-e", "process.exit(0)"],
    }));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        join(packageRoot, "bin", "child-runner.mjs"),
        "--spec",
        launchFile,
      ]);
      child.on("error", reject);
      child.on("close", () => resolve());
    });

    assert.match(await readFile(startedFile, "utf8"), /^\d+\n$/);
    const result = JSON.parse(await readFile(resultFile, "utf8")) as { childId: string; stopReason: string };
    assert.deepEqual(result, {
      childId: "test-child",
      text: "Child Pi exited before it reported: code=0 signal=none",
      stopReason: "error",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
