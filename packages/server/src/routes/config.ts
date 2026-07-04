import os from "node:os";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { saveConfig, type HubConfig } from "../config.js";
import { validateWorkspaceRoot } from "../security.js";

export function registerConfigRoutes(app: FastifyInstance, config: HubConfig): void {
  app.get("/api/config", async () => ({
    workspaceRoot: config.workspaceRoot,
    defaults: config.defaults,
    setupComplete: config.workspaceRoot !== null,
  }));

  app.patch("/api/config", async (req, reply) => {
    const body = z
      .object({
        workspaceRoot: z.string().min(1).max(1024).optional(),
        folderModel: z.string().max(64).optional(),
        mainModel: z.string().max(64).optional(),
      })
      .parse(req.body ?? {});

    if (body.workspaceRoot !== undefined) {
      const check = validateWorkspaceRoot(body.workspaceRoot);
      if (!check.ok) return reply.code(400).send({ error: check.reason });
      config.workspaceRoot = check.realPath;
      if (check.realPath === os.homedir()) {
        app.log.warn("workspace root set to home directory — a narrower folder is safer");
      }
    }
    if (body.folderModel) config.defaults.folderModel = body.folderModel;
    if (body.mainModel) config.defaults.mainModel = body.mainModel;
    saveConfig(config);
    return { ok: true, workspaceRoot: config.workspaceRoot };
  });
}
