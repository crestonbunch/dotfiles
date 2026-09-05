import net from "node:net";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { CLIENT_TIMEOUT_MS, MAX_REPLY_BYTES, PROTOCOL_VERSION, sanitizeTerminal } from "./protocol.mjs";

/** One bounded request. A lost steering receipt is not proof that delivery failed. */
export function requestDashboard({ socketPath, token, method, params = {}, timeoutMs = CLIENT_TIMEOUT_MS, signal }) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const decoder = new StringDecoder("utf8");
    let text = "";
    let bytes = 0;
    let settled = false;
    let sent = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      socket.destroy();
      if (error) reject(error);
      else resolve(data);
    };
    const lost = (message) => {
      const error = new Error(method === "steer" && sent
        ? `${message} Delivery is unknown; inspect the run before resending.`
        : message);
      error.code = method === "steer" && sent ? "delivery_unknown" : "disconnected";
      finish(error);
    };
    const cancel = () => lost("Dashboard request cancelled.");
    const timer = setTimeout(() => lost("Dashboard request timed out."), timeoutMs);
    socket.on("error", (error) => lost(sanitizeTerminal(error.message)));
    socket.on("close", () => { if (!settled) lost("Dashboard connection closed before its reply."); });
    socket.on("connect", () => {
      if (settled) return;
      sent = true;
      socket.write(`${JSON.stringify({ version: PROTOCOL_VERSION, id, token, method, params })}\n`);
    });
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REPLY_BYTES) return lost("Dashboard reply exceeded its size limit.");
      text += decoder.write(chunk);
    });
    socket.on("end", () => {
      try {
        const reply = JSON.parse((text + decoder.end()).trim());
        if (reply.id !== id || reply.version !== PROTOCOL_VERSION) throw new Error("Dashboard reply identity mismatch.");
        if (!reply.ok) {
          const error = new Error(sanitizeTerminal(String(reply.error?.message ?? "Dashboard request failed.")));
          error.code = reply.error?.code;
          return finish(error);
        }
        finish(undefined, reply.data);
      } catch (error) {
        lost(sanitizeTerminal(error.message));
      }
    });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
