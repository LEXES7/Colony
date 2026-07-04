import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { AgentManager } from "./agents/agentManager.js";
import { TeamManager } from "./agents/teamManager.js";
import { WorkflowManager } from "./agents/workflowManager.js";
import { loadConfig, loadToken, webDistDir } from "./config.js";
import { createHubServer } from "./mcp/hubTools.js";
import { Registry } from "./registry.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerWsRoute } from "./routes/ws.js";
import { makeRequestGuard } from "./security.js";

const config = loadConfig();
const token = loadToken();
const registry = new Registry();
const manager = new AgentManager(registry, config);
manager.setHubServer(createHubServer(registry, manager));
const teamManager = new TeamManager(registry, config, manager);
const workflowManager = new WorkflowManager(registry, manager, teamManager);

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 64 * 1024, // plenty for chat messages; blocks abuse
});

app.addHook("onRequest", makeRequestGuard(token, config.port));

await app.register(fastifyWebsocket);
registerWsRoute(app, token);
registerConfigRoutes(app, config);
registerProjectRoutes(app, registry, manager, config);
registerTeamRoutes(app, registry, teamManager, workflowManager, manager, config);
registerChatRoutes(app, manager, workflowManager);

app.get("/api/health", async () => ({ ok: true, name: "colony" }));

// Serve the built dashboard when it exists (production); in dev, Vite serves it.
if (fs.existsSync(webDistDir)) {
  // wildcard (default) resolves files at request time, so a rebuilt dist with
  // new hashed asset names works without restarting the server
  await app.register(fastifyStatic, { root: webDistDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === "GET" && !req.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });
}

// SECURITY: loopback only. LAN exposure would let other devices reach the API.
await app.listen({ host: "127.0.0.1", port: config.port });

const hasDist = fs.existsSync(webDistDir);
const uiUrl = hasDist
  ? `http://127.0.0.1:${config.port}/#token=${token}`
  : `http://localhost:5173/#token=${token}`;
app.log.info(`Colony is running (loopback only).`);
app.log.info(`Open the dashboard: ${uiUrl}`);
if (!config.workspaceRoot) {
  app.log.info(`First run: set your workspace root in the dashboard (or PATCH /api/config).`);
}
