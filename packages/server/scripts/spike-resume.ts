/**
 * M1 spike 2: prove session resume works across separate query() calls and
 * that the second call hits the prompt cache (cache_read_input_tokens > 0).
 *
 *   pnpm tsx scripts/spike-resume.ts <absolute-folder-path>
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;

const cwd = process.argv[2];
if (!cwd) {
  console.error("usage: pnpm tsx scripts/spike-resume.ts <absolute-folder-path>");
  process.exit(1);
}

async function run(prompt: string, resume?: string) {
  let sessionId = "";
  let text = "";
  let usage: any = {};
  const q = query({
    prompt,
    options: {
      cwd,
      resume,
      model: "claude-haiku-4-5",
      tools: ["Read", "Grep", "Glob"] as any,
      allowedTools: ["Read", "Grep", "Glob"],
      maxTurns: 4,
      settingSources: [],
    },
  });
  for await (const message of q) {
    const m = message as Record<string, any>;
    if (m.type === "result") {
      sessionId = m.session_id;
      text = m.result ?? "(no result)";
      usage = m.usage;
    }
  }
  return { sessionId, text, usage };
}

const first = await run("In one sentence, what is this folder about? Look at at most 2 files.");
console.log("Q1 session:", first.sessionId);
console.log("Q1 answer :", first.text);
console.log("Q1 usage  :", JSON.stringify(first.usage));

const second = await run("Based on what you already looked at, name one file you read.", first.sessionId);
console.log("Q2 session:", second.sessionId);
console.log("Q2 answer :", second.text);
console.log("Q2 usage  :", JSON.stringify(second.usage));
console.log(
  "cache_read_input_tokens on Q2:",
  second.usage?.cache_read_input_tokens,
  "(> 0 means resume reused cached context)"
);
