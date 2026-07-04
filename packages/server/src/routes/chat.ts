import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentManager } from "../agents/agentManager.js";

export function registerChatRoutes(app: FastifyInstance, manager: AgentManager): void {
  // The response also arrives via WS events (chat.delta / chat.done); the
  // HTTP body is the fallback for non-WS clients like curl.
  app.post("/api/chat", async (req, reply) => {
    const body = z.object({ message: z.string().min(1).max(20_000) }).parse(req.body);
    try {
      return await manager.chat(body.message);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "chat failed" });
    }
  });
}
