import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let launch = process.argv.slice(2);
if (launch[0] === "--spec" && launch[1]) {
  const spec = JSON.parse(await readFile(launch[1], "utf8"));
  Object.assign(process.env, spec.environment);
  launch = spec.command;
}
const [command, ...args] = launch;
if (!command) process.exit(2);

await markStarted();
const child = spawn(command, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", async (error) => {
  await reportFailure(`Cannot start child Pi: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", async (code, signal) => {
  await reportFailure(`Child Pi exited before it reported: code=${code ?? "none"} signal=${signal ?? "none"}`);
  process.exitCode = code ?? 1;
});

async function markStarted() {
  const path = process.env.PIZJ_STARTED_FILE;
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${process.pid}\n`, { mode: 0o600 });
}

async function reportFailure(text) {
  const path = process.env.PIZJ_RESULT_FILE;
  if (!path) return;
  try {
    await access(path);
    return;
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const result = {
    childId: process.env.PIZJ_CHILD_ID ?? "unknown",
    text,
    stopReason: "error",
  };
  await writeFile(temporary, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
