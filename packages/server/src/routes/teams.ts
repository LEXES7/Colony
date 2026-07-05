import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentManager } from "../agents/agentManager.js";
import type { TeamManager } from "../agents/teamManager.js";
import type { WorkflowManager } from "../agents/workflowManager.js";
import { bus } from "../bus.js";
import type { HubConfig } from "../config.js";
import type { Registry } from "../registry.js";
import { validateProjectPath } from "../security.js";

const memberInput = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  role: z.enum(["pm", "developer", "reviewer", "devops", "architect", "tester", "security"]),
  model: z.string().max(64).nullable().optional(),
});

export function registerTeamRoutes(
  app: FastifyInstance,
  registry: Registry,
  teams: TeamManager,
  workflows: WorkflowManager,
  _agents: AgentManager,
  config: HubConfig
): void {
  const broadcast = () => bus.emit({ type: "teams.updated", teams: teams.toPublicTeams() });

  app.get("/api/teams", async () => ({
    teams: teams.toPublicTeams(),
    tasks: registry.tasks.map((t) => teams.toPublicTask(t)),
    workflows: registry.workflows.map((w) => workflows.toPublic(w)),
  }));

  /** Company mode: start the investor→CEO→PM pipeline for a team. */
  app.post("/api/teams/:id/workflow", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ prompt: z.string().min(10).max(4000) }).parse(req.body);
    try {
      return await workflows.start(id, body.prompt);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "failed" });
    }
  });

  app.post("/api/teams", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(64),
        path: z.string().min(1).max(1024),
        members: z.array(memberInput).min(1).max(8),
      })
      .parse(req.body);
    const check = validateProjectPath(body.path, config.workspaceRoot);
    if (!check.ok) return reply.code(400).send({ error: check.reason });
    try {
      const team = registry.addTeam(body.name, check.realPath, body.members);
      broadcast();
      return reply.code(201).send({ id: team.id });
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "conflict" });
    }
  });

  app.delete("/api/teams/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!registry.removeTeam(id)) return reply.code(404).send({ error: "not found" });
    broadcast();
    return { ok: true };
  });

  /** PM plans the goal into tasks. Long-running; returns when done. */
  app.post("/api/teams/:id/plan", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ goal: z.string().min(10).max(4000) }).parse(req.body);
    try {
      return await teams.plan(id, body.goal);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "plan failed" });
    }
  });

  /** Resume a failed venture where it stopped. */
  app.post("/api/workflows/:id/resume", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    try {
      return await workflows.resume(id);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "resume failed" });
    }
  });

  /** Run the whole board in order — fire-and-forget, watch bus events. */
  app.post("/api/teams/:id/run-all", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!registry.findTeam(id)) return reply.code(404).send({ error: "not found" });
    teams.runAll(id).catch((err) => app.log.error({ err }, "run-all failed"));
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/tasks/:id/run", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    try {
      return await teams.runTask(id);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "run failed" });
    }
  });

  app.post("/api/tasks/:id/review", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    try {
      return await teams.reviewTask(id);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "review failed" });
    }
  });

  /** Manual board edits by the user: status, ETA, assignee. */
  app.patch("/api/tasks/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(["todo", "done", "blocked"]).optional(),
        etaMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().optional(),
        assignee: z.string().optional(),
      })
      .parse(req.body ?? {});
    const task = registry.findTask(id);
    if (!task) return reply.code(404).send({ error: "not found" });
    if (body.assignee) {
      const team = registry.findTeam(task.teamId);
      if (!team?.members.some((m) => m.name === body.assignee)) {
        return reply.code(400).send({ error: "assignee is not a team member" });
      }
    }
    registry.updateTask(id, (t) => {
      if (body.status) t.status = body.status;
      if (body.etaMinutes !== undefined) t.etaMinutes = body.etaMinutes;
      if (body.assignee) t.assignee = body.assignee;
    });
    bus.emit({ type: "task.updated", task: teams.toPublicTask(registry.findTask(id)!) });
    return { ok: true };
  });

  app.delete("/api/tasks/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!registry.removeTask(id)) return reply.code(404).send({ error: "not found" });
    bus.emit({ type: "task.deleted", taskId: id });
    return { ok: true };
  });
}
