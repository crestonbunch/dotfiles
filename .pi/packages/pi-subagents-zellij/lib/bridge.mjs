import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  MAX_REPLY_BYTES,
  MAX_REQUEST_BYTES,
  OPERATION_TIMEOUT_MS,
  RPC_TIMEOUT_MS,
  PROTOCOL_VERSION,
  ProtocolError,
  resolveSelection,
  sanitizeTerminal,
  validateRequest,
} from "./protocol.mjs";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createEventRpc(events, options = {}) {
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const pending = new Set();
  let closed = false;

  async function call(method, params = {}, { signal } = {}) {
    if (closed) throw new ProtocolError("disconnected", "Dashboard bridge is closed.");
    const requestId = randomUUID();
    const replyEvent = `${RPC_REPLY_PREFIX}${requestId}`;
    return new Promise((resolve, reject) => {
      let unsubscribe;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        pending.delete(cancel);
        if (typeof unsubscribe === "function") unsubscribe();
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new ProtocolError("timeout", `pi-subagents ${method} request timed out.`)), timeoutMs);
      const cancel = () => finish(reject, new ProtocolError("disconnected", "Dashboard bridge closed while waiting for pi-subagents."));
      pending.add(cancel);
      unsubscribe = events.on(replyEvent, (reply) => {
        if (!reply || typeof reply !== "object" || reply.requestId !== requestId || reply.version !== 1) return;
        if (reply.success === true) finish(resolve, reply.data);
        else finish(reject, new ProtocolError(String(reply.error?.code ?? "rpc_error"), sanitizeTerminal(String(reply.error?.message ?? "pi-subagents request failed."))));
      });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) return cancel();
      try {
        events.emit(RPC_REQUEST, {
          version: 1,
          requestId,
          method,
          params,
          source: { extension: "pi-subagents-zellij" },
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  return {
    call,
    close() {
      if (closed) return;
      closed = true;
      for (const cancel of [...pending]) cancel();
    },
  };
}

function asyncSnapshot(status) {
  return status?.asyncSnapshot;
}

async function freshSelection(rpc, runId, childId, options = {}) {
  const list = await rpc.call("status", {});
  const selection = resolveSelection(asyncSnapshot(list), runId, childId, options);
  // A targeted status request makes package ownership, session and current run state authoritative.
  await rpc.call("status", { id: selection.runId });
  return selection;
}

function steeringReceipt(data) {
  const receipt = data?.details?.steering;
  if (!receipt || typeof receipt !== "object") throw new ProtocolError("invalid_reply", "pi-subagents returned no steering receipt.");
  if (receipt.deliveryStatus !== "delivered" && receipt.deliveryStatus !== "queued") {
    throw new ProtocolError("invalid_reply", "pi-subagents returned an invalid steering delivery status.");
  }
  return {
    requestId: sanitizeTerminal(String(receipt.requestId ?? "")),
    state: sanitizeTerminal(String(receipt.state ?? "")),
    deliveryStatus: receipt.deliveryStatus,
    sourceRunId: sanitizeTerminal(String(receipt.sourceRunId ?? "")),
    targets: Array.isArray(receipt.targets)
      ? receipt.targets.slice(0, 32).map((target) => ({
          index: Number.isSafeInteger(target?.index) ? target.index : undefined,
          state: sanitizeTerminal(String(target?.state ?? "")),
          reason: target?.reason === undefined ? undefined : sanitizeTerminal(String(target.reason)),
        }))
      : [],
  };
}

export function createDashboardHandler({ rpc, token }) {
  return async (raw, { signal } = {}) => {
    const request = validateRequest(raw, token);
    // Cancellation must be checked between ownership queries, before any mutation dispatch.
    const scopedRpc = {
      async call(method, params) {
        if (signal?.aborted) throw new ProtocolError("disconnected", "Dashboard request was cancelled.");
        try {
          const result = await rpc.call(method, params, { signal });
          if (signal?.aborted) throw new ProtocolError("disconnected", "Dashboard request was cancelled.");
          return result;
        } catch (error) {
          if (method === "steer" && (signal?.aborted || error?.code === "timeout" || error?.code === "disconnected")) {
            throw new ProtocolError("delivery_unknown", "Steering receipt was lost. Delivery is unknown; inspect the run before resending.");
          }
          throw error;
        }
      },
    };
    if (request.method === "snapshot") {
      const [ping, status] = await Promise.all([scopedRpc.call("ping", {}), scopedRpc.call("status", {})]);
      if (ping?.version !== 1 || ping?.capabilities?.fleetStatus?.version !== 1 || ping?.capabilities?.asyncStatusSnapshot?.version !== 1) {
        throw new ProtocolError("unavailable", "Installed pi-subagents lacks the required public status capabilities.");
      }
      return { session: ping.session ?? {}, snapshot: asyncSnapshot(status), fleet: status?.fleet };
    }

    const selection = await freshSelection(scopedRpc, request.params.runId, request.params.childId, { requireActive: request.method === "steer" });
    if (request.method === "transcript") {
      const transcript = await scopedRpc.call("status", {
        id: selection.runId,
        view: "transcript",
        lines: request.params.lines,
        ...(selection.index === undefined ? {} : { index: selection.index }),
      });
      return { runId: selection.runId, childId: selection.childId, text: sanitizeTerminal(String(transcript?.text ?? "")) };
    }

    if (selection.index === undefined && selection.requiresBroadcastConfirmation && !request.params.broadcastConfirmed) {
      throw new ProtocolError("confirmation_required", "Run-level guidance may target multiple eligible children; confirm broadcast explicitly.");
    }
    const data = await scopedRpc.call("steer", {
      id: selection.runId,
      message: request.params.message,
      mode: request.params.mode,
      ...(selection.index === undefined ? {} : { index: selection.index }),
    });
    return { runId: selection.runId, childId: selection.childId, receipt: steeringReceipt(data) };
  };
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Dashboard socket directory is unsafe: ${path}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`Dashboard socket directory is not owned by this user: ${path}`);
  chmodSync(path, 0o700);
}

function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function encodeReply(reply) {
  let line = `${JSON.stringify(reply)}\n`;
  if (Buffer.byteLength(line, "utf8") <= MAX_REPLY_BYTES) return line;
  line = `${JSON.stringify({ version: PROTOCOL_VERSION, id: reply.id ?? "unknown", ok: false, error: { code: "reply_too_large", message: "Dashboard reply exceeded its size limit." } })}\n`;
  return line;
}

export async function startSocketBridge({ socketPath, handler, timeoutMs = OPERATION_TIMEOUT_MS }) {
  ensurePrivateDirectory(dirname(socketPath));
  safeUnlink(socketPath);
  const sockets = new Set();
  let closed = false;
  const server = net.createServer((socket) => {
    if (sockets.size >= 8) return socket.destroy();
    sockets.add(socket);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      socket.destroy();
    }, timeoutMs);
    let bytes = 0;
    let input = "";
    let handled = false;
    const decoder = new StringDecoder("utf8");
    socket.on("data", (chunk) => {
      if (handled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        handled = true;
        socket.end(encodeReply({ version: PROTOCOL_VERSION, id: "unknown", ok: false, error: { code: "request_too_large", message: "Dashboard request exceeded its size limit." } }));
        return;
      }
      input += decoder.write(chunk);
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      let raw;
      try {
        raw = JSON.parse(input.slice(0, newline));
      } catch {
        socket.end(encodeReply({ version: PROTOCOL_VERSION, id: "unknown", ok: false, error: { code: "invalid_json", message: "Dashboard request was not valid JSON." } }));
        return;
      }
      Promise.resolve().then(() => handler(raw, { signal: controller.signal })).then(
        (data) => socket.end(encodeReply({ version: PROTOCOL_VERSION, id: raw?.id ?? "unknown", ok: true, data })),
        (error) => socket.end(encodeReply({ version: PROTOCOL_VERSION, id: raw?.id ?? "unknown", ok: false, error: { code: String(error?.code ?? "bridge_error"), message: sanitizeTerminal(errorMessage(error)) } })),
      );
    });
    socket.on("end", () => controller.abort());
    socket.on("close", () => {
      clearTimeout(timer);
      controller.abort();
      sockets.delete(socket);
    });
    socket.on("error", () => {});
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      chmodSync(socketPath, 0o600);
      resolve();
    });
  });

  return {
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
      safeUnlink(socketPath);
    },
  };
}
