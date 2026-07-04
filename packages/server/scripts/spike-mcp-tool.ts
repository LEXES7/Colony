/**
 * M1 spike 3: prove in-process MCP tools work with a plain string prompt.
 *
 *   pnpm tsx scripts/spike-mcp-tool.ts
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

delete process.env.ANTHROPIC_API_KEY;

let toolCalled = false;

const hub = createSdkMcpServer({
  name: "hub",
  version: "1.0.0",
  tools: [
    tool(
      "ask_project_agent",
      "Ask a project expert agent a question.",
      { project: z.string(), question: z.string() },
      async ({ project, question }) => {
        toolCalled = true;
        console.log(`[tool] called with project=${project} question=${question}`);
        return {
          content: [{ type: "text" as const, text: `${project} uses JWT auth in src/auth.ts` }],
        };
      },
      { annotations: { readOnlyHint: true } }
    ),
  ],
});

const q = query({
  prompt: 'Use the ask_project_agent tool to ask project "demo" how auth works, then repeat its answer.',
  options: {
    mcpServers: { hub },
    allowedTools: ["mcp__hub__*"],
    tools: [] as any,
    maxTurns: 3,
    model: "claude-haiku-4-5",
  },
});

for await (const message of q) {
  const m = message as Record<string, any>;
  if (m.type === "result") {
    console.log("subtype:", m.subtype);
    console.log("result :", m.result);
  }
}
console.log("tool handler invoked:", toolCalled);
