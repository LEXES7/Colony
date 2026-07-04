import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentManager } from "../agents/agentManager.js";
import type { Registry } from "../registry.js";

/**
 * In-process MCP server exposed to the main agent. Handlers must return
 * isError instead of throwing — a thrown error kills the whole chat query.
 */
export function createHubServer(registry: Registry, manager: AgentManager) {
  return createSdkMcpServer({
    name: "hub",
    version: "1.0.0",
    tools: [
      tool(
        "ask_project_agent",
        "Ask another registered project's expert agent one specific question about its codebase. " +
          "Use this instead of exploring other projects yourself. The expert answers briefly with file citations.",
        {
          project: z.string().describe("Registered project name (see list_projects)"),
          question: z.string().min(3).max(2000).describe("One specific, answerable question"),
        },
        async ({ project, question }) => {
          manager.emitAgentMessage("main", project, "question", question);
          try {
            const answer = await manager.askProject(project, question);
            manager.emitAgentMessage(project, "main", "answer", answer);
            return { content: [{ type: "text" as const, text: answer }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            manager.emitAgentMessage(project, "main", "error", message);
            return {
              content: [{ type: "text" as const, text: `Could not consult "${project}": ${message}` }],
              isError: true,
            };
          }
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "list_projects",
        "List registered projects with their enabled state, so you know which experts are available.",
        {},
        async () => {
          const lines = registry.projects.map(
            (p) => `- ${p.name} (${p.enabled ? "enabled" : "disabled"}): ${p.summary?.slice(0, 120) ?? "no summary"}`
          );
          return {
            content: [{ type: "text" as const, text: lines.join("\n") || "No projects registered." }],
          };
        },
        { annotations: { readOnlyHint: true } }
      ),
    ],
  });
}
