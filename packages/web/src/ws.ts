import type { HubEvent } from "@colony/shared";
import { useHub } from "./store";

let socket: WebSocket | null = null;
let retryTimer: number | null = null;

export function connectWs(): void {
  const { token } = useHub.getState();
  if (!token || socket) return;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.onopen = () => {
    // First message must be auth; the server closes the socket otherwise.
    socket?.send(JSON.stringify({ type: "auth", token }));
    useHub.getState().setConnected(true);
  };

  socket.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data as string) as
        | { type: "replay"; events: HubEvent[] }
        | { type: "event"; event: HubEvent };
      const apply = useHub.getState().applyEvent;
      if (parsed.type === "replay") parsed.events.forEach(apply);
      else apply(parsed.event);
    } catch {
      /* ignore malformed frames */
    }
  };

  socket.onclose = () => {
    socket = null;
    useHub.getState().setConnected(false);
    if (retryTimer === null) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connectWs();
      }, 2000);
    }
  };
}
