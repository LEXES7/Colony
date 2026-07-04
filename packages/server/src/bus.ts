import { EventEmitter } from "node:events";
import type { HubEvent } from "@colony/shared";

const RING_SIZE = 200;

/** Omit that distributes over union members (plain Omit collapses unions). */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

/**
 * In-process event bus. Everything user-visible (inter-agent messages, tool
 * activity, usage, status) flows through here; the WS route fans it out to
 * dashboard clients and replays the ring buffer on connect.
 */
class Bus {
  private emitter = new EventEmitter();
  private ring: HubEvent[] = [];

  emit(event: DistributiveOmit<HubEvent, "ts"> & { ts?: number }): void {
    const full = { ts: Date.now(), ...event } as HubEvent;
    // chat deltas are high-volume transient noise; don't retain them
    if (full.type !== "chat.delta") {
      this.ring.push(full);
      if (this.ring.length > RING_SIZE) this.ring.shift();
    }
    this.emitter.emit("event", full);
  }

  subscribe(fn: (event: HubEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }

  replay(): HubEvent[] {
    return [...this.ring];
  }
}

export const bus = new Bus();
