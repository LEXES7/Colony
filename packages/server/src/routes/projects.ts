import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProjectPublic } from "@colony/shared";
import type { AgentManager } from "../agents/agentManager.js";
import { bus } from "../bus.js";
import type { HubConfig } from "../config.js";
import type { Registry } from "../registry.js";
import { validateProjectPath } from "../security.js";

const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, {
  message: "name must be lowercase letters, digits and dashes",
});

export function toPublic(registry: Registry, manager: AgentManager): ProjectPublic[] {
  return registry.projects.map((p) => ({
    name: p.name,
    path: p.path,
    enabled: p.enabled,
    model: p.model,
    summary: p.summary,
    summaryGeneratedAt: p.summaryGeneratedAt,
    status: manager.status(p.name),
    usage: p.usage,
  }));
}

export function registerProjectRoutes(
  app: FastifyInstance,
  registry: Registry,
  manager: AgentManager,
  config: HubConfig
): void {
  const broadcast = () =>
    bus.emit({ type: "registry.updated", projects: toPublic(registry, manager) });

  app.get("/api/projects", async () => toPublic(registry, manager));

  app.post("/api/projects", async (req, reply) => {
    const body = z.object({ name: nameSchema, path: z.string().min(1).max(1024) }).parse(req.body);
    const check = validateProjectPath(body.path, config.workspaceRoot);
    if (!check.ok) return reply.code(400).send({ error: check.reason });
    try {
      registry.addProject(body.name, check.realPath);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "conflict" });
    }
    broadcast();
    return reply.code(201).send({ ok: true });
  });

  app.patch("/api/projects/:name", async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.params);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        model: z.string().max(64).nullable().optional(),
        resetSession: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const project = registry.find(name);
    if (!project) return reply.code(404).send({ error: "not found" });

    const firstEnable = body.enabled === true && !project.enabled && !project.summary;
    registry.mutate(() => {
      if (body.enabled !== undefined) project.enabled = body.enabled;
      if (body.model !== undefined) project.model = body.model;
      if (body.resetSession) project.lastSessionId = null;
    });
    broadcast();

    // Fire-and-forget: summary generation happens in the background; the
    // dashboard hears about it via summary.created / registry.updated events.
    if (firstEnable) {
      manager
        .summarize(name)
        .then(broadcast)
        .catch((err) =>
          app.log.error({ err }, `summary generation failed for ${name}`)
        );
    }
    return { ok: true };
  });

  app.post("/api/projects/:name/summarize", async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.params);
    if (!registry.find(name)) return reply.code(404).send({ error: "not found" });
    const summary = await manager.summarize(name);
    broadcast();
    return { summary };
  });

  app.post("/api/projects/:name/ask", async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.params);
    const body = z.object({ question: z.string().min(3).max(4000) }).parse(req.body);
    if (!registry.find(name)) return reply.code(404).send({ error: "not found" });
    try {
      const answer = await manager.askProject(name, body.question);
      return { answer };
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "failed" });
    }
  });

  app.delete("/api/projects/:name", async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.params);
    if (!registry.removeProject(name)) return reply.code(404).send({ error: "not found" });
    broadcast();
    return { ok: true };
  });
}
