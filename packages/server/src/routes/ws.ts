import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { bus } from "../bus.js";
import { timingSafeEqualStr } from "../security.js";

const AUTH_TIMEOUT_MS = 5000;

/**
 * WS clients must authenticate with the bearer token as their first message
 * ({"type":"auth","token":"..."}) — browsers cannot set headers on WebSocket
 * connects, and putting the token in the URL would leak it into logs.
 */
export function registerWsRoute(app: FastifyInstance, token: string): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    let authed = false;
    let unsubscribe: (() => void) | null = null;

    const authTimer = setTimeout(() => {
      if (!authed) socket.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (raw: Buffer) => {
      if (authed) return; // clients only ever send the auth message
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.close(4400, "bad message");
        return;
      }
      const msg = parsed as { type?: string; token?: string };
      if (msg.type !== "auth" || typeof msg.token !== "string" || !timingSafeEqualStr(msg.token, token)) {
        socket.close(4401, "bad token");
        return;
      }
      authed = true;
      clearTimeout(authTimer);
      socket.send(JSON.stringify({ type: "replay", events: bus.replay() }));
      unsubscribe = bus.subscribe((event) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "event", event }));
        }
      });
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      unsubscribe?.();
    });
  });
}
