import assert from "node:assert/strict";
import test from "node:test";
import { slugify, tabLabel, waitFor } from "../extensions/runtime.ts";

test("slugify creates a bounded workspace component", () => {
  assert.equal(slugify("Add OAuth to API!!!"), "add-oauth-to-api");
  assert.equal(slugify("a".repeat(60)), "a".repeat(40));
});

test("workspace tab labels identify the repository within 36 characters", () => {
  assert.equal(
    tabLabel("https://github.com/duolingo/infra-eks-argo-cd.git", "Create Squadron worker Argo manifests"),
    "infra-eks-argo-cd: create-squadron-w",
  );
});

test("waitFor returns the first available result", async () => {
  let reads = 0;
  const result = await waitFor(async () => {
    reads += 1;
    return reads === 2 ? "ready" : undefined;
  }, 1000);

  assert.equal(result, "ready");
  assert.equal(reads, 2);
});

test("waitFor rejects an aborted wait", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    waitFor(async () => undefined, 1000, controller.signal),
    /cancelled/,
  );
});
