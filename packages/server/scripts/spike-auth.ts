/**
 * M1 spike 1: prove the Agent SDK runs on the local Claude Code subscription
 * login (ANTHROPIC_API_KEY must be unset) and show usage/cost field shapes.
 *
 *   pnpm tsx scripts/spike-auth.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;

const q = query({
  prompt: "Reply with exactly: colony auth ok",
  options: { tools: [], maxTurns: 1, model: "claude-haiku-4-5" },
});

for await (const message of q) {
  if (message.type === "result") {
    const m = message as Record<string, any>;
    console.log("subtype:        ", m.subtype);
    console.log("result:         ", m.result);
    console.log("session_id:     ", m.session_id);
    console.log("total_cost_usd: ", m.total_cost_usd, "(estimate on subscription)");
    console.log("usage:          ", JSON.stringify(m.usage));
    console.log("modelUsage:     ", JSON.stringify(m.modelUsage));
  }
}
