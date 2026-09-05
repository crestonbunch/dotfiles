export const PROTOCOL_VERSION = 1;
export const RPC_TIMEOUT_MS = 5000;
// A control operation performs three sequential RPCs; leave time to return its receipt.
export const OPERATION_TIMEOUT_MS = 16000;
export const CLIENT_TIMEOUT_MS = 18000;
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_REPLY_BYTES = 256 * 1024;
export const MAX_MESSAGE_LENGTH = 8 * 1024;
export const MAX_TRANSCRIPT_LINES = 200;

const METHODS = new Set(["snapshot", "transcript", "steer"]);
const STATES = new Set(["queued", "running"]);
const STEP_ID = /^step:(0|[1-9][0-9]{0,5})$/;

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, label, max = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n\0]/.test(value)) {
    throw new ProtocolError("invalid_request", `${label} is invalid.`);
  }
  return value;
}

export function sanitizeTerminal(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x1b\x9b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\x07|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

export function validateRequest(value, expectedToken) {
  if (!record(value) || value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("unsupported_version", "Unsupported dashboard protocol version.");
  }
  const id = boundedString(value.id, "request id", 128);
  const token = boundedString(value.token, "session token", 256);
  if (token !== expectedToken) throw new ProtocolError("unauthorized", "Dashboard session token was rejected.");
  if (!METHODS.has(value.method)) throw new ProtocolError("unsupported_method", "Unsupported dashboard method.");
  const params = value.params === undefined ? {} : value.params;
  if (!record(params)) throw new ProtocolError("invalid_request", "params must be an object.");

  if (value.method === "snapshot") {
    if (Object.keys(params).length !== 0) throw new ProtocolError("invalid_request", "snapshot does not accept parameters.");
    return { version: PROTOCOL_VERSION, id, method: value.method, params: {} };
  }

  const allowed = value.method === "transcript"
    ? new Set(["runId", "childId", "lines"])
    : new Set(["runId", "childId", "message", "mode", "broadcastConfirmed"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new ProtocolError("invalid_request", "Unexpected request parameter.");
  const runId = boundedString(params.runId, "run id", 256);
  const childId = params.childId === undefined ? undefined : boundedString(params.childId, "child id", 256);

  if (value.method === "transcript") {
    const lines = params.lines === undefined ? 120 : params.lines;
    if (!Number.isSafeInteger(lines) || lines < 1 || lines > MAX_TRANSCRIPT_LINES) {
      throw new ProtocolError("invalid_request", `lines must be between 1 and ${MAX_TRANSCRIPT_LINES}.`);
    }
    return { version: PROTOCOL_VERSION, id, method: value.method, params: { runId, childId, lines } };
  }

  if (typeof params.message !== "string" || !params.message.trim() || Buffer.byteLength(params.message, "utf8") > MAX_MESSAGE_LENGTH) {
    throw new ProtocolError("invalid_request", `message must be non-empty and at most ${MAX_MESSAGE_LENGTH} bytes.`);
  }
  const mode = params.mode ?? "steer";
  if (!new Set(["steer", "follow_up", "auto"]).has(mode)) throw new ProtocolError("invalid_request", "Invalid steering mode.");
  if (params.broadcastConfirmed !== undefined && typeof params.broadcastConfirmed !== "boolean") {
    throw new ProtocolError("invalid_request", "broadcastConfirmed must be boolean.");
  }
  return {
    version: PROTOCOL_VERSION,
    id,
    method: value.method,
    params: { runId, childId, message: params.message.trim(), mode, broadcastConfirmed: params.broadcastConfirmed === true },
  };
}

export function resolveSelection(snapshot, runId, childId, options = {}) {
  if (!record(snapshot) || snapshot.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) {
    throw new ProtocolError("unavailable", "pi-subagents did not return a supported async status snapshot.");
  }
  const runs = snapshot.runs.filter((run) => record(run) && run.id === runId);
  if (runs.length !== 1) throw new ProtocolError(runs.length ? "ambiguous" : "not_found", `Run '${runId}' is not uniquely available.`);
  const run = runs[0];
  if (options.requireActive !== false && !STATES.has(run.state)) throw new ProtocolError("invalid_state", `Run '${runId}' is ${String(run.state)}.`);
  const children = Array.isArray(run.children) ? run.children.filter(record) : [];

  if (childId === undefined) {
    return {
      run,
      runId,
      index: undefined,
      childId: undefined,
      requiresBroadcastConfirmation: children.length > 1 || Number(snapshot.omitted?.children ?? 0) > 0,
    };
  }
  if (!STEP_ID.test(childId)) {
    throw new ProtocolError("unmappable_child", `Child '${childId}' has no public canonical numeric index; individual control is unavailable.`);
  }
  const matches = children.filter((child) => child.id === childId);
  if (matches.length !== 1) throw new ProtocolError(matches.length ? "ambiguous" : "not_found", `Child '${childId}' is not uniquely available under '${runId}'.`);
  const child = matches[0];
  if (child.kind !== "step") throw new ProtocolError("unmappable_child", `Node '${childId}' is not a public child step.`);
  if (options.requireActive !== false && !STATES.has(child.state)) throw new ProtocolError("invalid_state", `Child '${childId}' is ${String(child.state)}.`);
  const index = Number(childId.slice(5));
  if (!Number.isSafeInteger(index)) throw new ProtocolError("unmappable_child", `Child '${childId}' has no safe numeric index.`);
  return { run, runId, index, childId, child, requiresBroadcastConfirmation: false };
}

export function projectPickerItems(snapshot) {
  if (!record(snapshot) || !Array.isArray(snapshot.runs)) return [];
  const items = [];
  for (const run of snapshot.runs) {
    if (!record(run) || typeof run.id !== "string") continue;
    items.push({ kind: "run", runId: run.id, id: `run:${run.id}`, label: `${run.label ?? run.id} [all eligible children]`, state: run.state, targetable: STATES.has(run.state) });
    for (const child of Array.isArray(run.children) ? run.children : []) {
      if (!record(child) || typeof child.id !== "string") continue;
      const targetable = child.kind === "step" && STEP_ID.test(child.id) && STATES.has(child.state);
      items.push({ kind: "child", runId: run.id, childId: child.id, id: `child:${run.id}:${child.id}`, label: `${child.label ?? child.id}${targetable ? "" : " [view only]"}`, state: child.state, targetable });
    }
  }
  return items;
}
