import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { emptyUsage } from "@colony/shared";
import type { AgentManager } from "../agents/agentManager.js";
import type { WorkflowManager } from "../agents/workflowManager.js";
import { bus } from "../bus.js";

export function registerChatRoutes(
  app: FastifyInstance,
  manager: AgentManager,
  workflows: WorkflowManager
): void {
  // The response also arrives via WS events (chat.delta / chat.done); the
  // HTTP body is the fallback for non-WS clients like curl.
  app.post("/api/chat", async (req, reply) => {
    const body = z.object({ message: z.string().min(1).max(20_000) }).parse(req.body);
    try {
      // an open company-pipeline gate captures the investor's reply
      if (workflows.activeGate()) {
        const text = await workflows.answerGate(body.message);
        bus.emit({ type: "chat.done", text, usage: emptyUsage() });
        return { text, usage: emptyUsage() };
      }
      return await manager.chat(body.message);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "chat failed" });
    }
  });
}
