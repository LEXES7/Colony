import crypto from "node:crypto";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStatus, Project, Usage } from "@colony/shared";
import { bus } from "../bus.js";
import type { HubConfig } from "../config.js";
import type { Registry } from "../registry.js";
import { isSecretFilePath } from "../security.js";
import { briefAnswerProtocol, mainAgentPrompt, SUMMARIZER_PROMPT } from "./prompts.js";

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

const CONSULT_TIMEOUT_MS = 180_000;
const SUMMARY_TIMEOUT_MS = 300_000;
const CHAT_TIMEOUT_MS = 600_000;

interface QueryOutcome {
  text: string;
  sessionId: string | null;
  usage: Usage;
  truncated: boolean;
}

/**
 * Deny hook: agents never read secret-looking files, no matter what a prompt
 * (or injected instruction inside a repo) asks for.
 */
function secretFileGuard() {
  return {
    PreToolUse: [
      {
        matcher: "Read",
        hooks: [
          async (input: unknown) => {
            const toolInput = (input as { tool_input?: { file_path?: string } }).tool_input;
            const filePath = toolInput?.file_path ?? "";
            if (isSecretFilePath(filePath)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason:
                    "Colony blocks agents from reading secret files (.env, keys, credentials).",
                },
              };
            }
            return {};
          },
        ],
      },
    ],
  };
}

function toUsage(raw: Record<string, unknown> | undefined, costUsd: number): Usage {
  const num = (key: string) => (typeof raw?.[key] === "number" ? (raw[key] as number) : 0);
  return {
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    cacheReadTokens: num("cache_read_input_tokens"),
    cacheCreationTokens: num("cache_creation_input_tokens"),
    estCostUsd: costUsd,
    queries: 1,
  };
}

export class AgentManager {
  private statuses = new Map<string, AgentStatus>();
  private queues = new Map<string, Promise<unknown>>();
  private hubMcpServer: unknown = null;
  private chatBusy = false;

  constructor(
    private registry: Registry,
    private config: HubConfig
  ) {}

  /** Set after construction because the hub MCP tools call back into this manager. */
  setHubServer(server: unknown): void {
    this.hubMcpServer = server;
  }

  status(name: string): AgentStatus {
    const project = this.registry.find(name);
    if (!project?.enabled) return "off";
    return this.statuses.get(name) ?? "idle";
  }

  private setStatus(name: string, status: AgentStatus): void {
    this.statuses.set(name, status);
    bus.emit({ type: "agent.status", agent: name, status });
  }

  /** Serialize queries per agent so two consults never race one session. */
  private enqueue<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(agentId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(agentId, next.catch(() => undefined));
    return next;
  }

  /**
   * Core query runner. Streams SDK messages, surfaces tool activity on the
   * bus, extracts final text + usage + session id.
   */
  private async runQuery(
    agentId: string,
    prompt: string,
    options: Options,
    timeoutMs: number,
    onDelta?: (text: string) => void
  ): Promise<QueryOutcome> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let sessionId: string | null = null;
    let lastAssistantText = "";
    let resultText: string | null = null;
    let usage: Usage = toUsage(undefined, 0);
    let truncated = false;

    try {
      const q = query({
        prompt,
        options: { ...options, abortController: abort, includePartialMessages: Boolean(onDelta) },
      });
      for await (const message of q as AsyncIterable<SDKMessage>) {
        const m = message as Record<string, any>;
        switch (m.type) {
          case "system":
            if (m.subtype === "init" && typeof m.session_id === "string") {
              sessionId = m.session_id;
            }
            break;
          case "stream_event": {
            const event = m.event;
            if (
              onDelta &&
              event?.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              typeof event.delta.text === "string"
            ) {
              onDelta(event.delta.text);
            }
            break;
          }
          case "assistant": {
            const content = m.message?.content ?? [];
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                lastAssistantText = block.text;
              } else if (block.type === "tool_use") {
                bus.emit({
                  type: "agent.tool",
                  agent: agentId,
                  tool: String(block.name ?? "tool"),
                  detail: summarizeToolInput(block.input),
                });
              }
            }
            break;
          }
          case "result": {
            if (typeof m.session_id === "string") sessionId = m.session_id;
            usage = toUsage(m.usage, typeof m.total_cost_usd === "number" ? m.total_cost_usd : 0);
            if (m.subtype === "success" && typeof m.result === "string") {
              resultText = m.result;
            } else if (m.subtype === "error_max_turns") {
              truncated = true;
            } else if (typeof m.subtype === "string" && m.subtype.startsWith("error")) {
              throw new Error(`agent query failed: ${m.subtype}`);
            }
            break;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (abort.signal.aborted) {
      throw new Error(`agent "${agentId}" timed out after ${Math.round(timeoutMs / 1000)}s`);
    }

    const text =
      resultText ??
      (truncated
        ? `${lastAssistantText}\n\n[answer truncated: hit the turn cap]`
        : lastAssistantText);
    return { text, sessionId, usage, truncated };
  }

  private recordProjectUsage(project: Project, delta: Usage): void {
    this.registry.addUsage(project.usage, delta);
    bus.emit({ type: "agent.usage", agent: project.name, delta, total: project.usage });
  }

  /** Consult a project-expert agent (used by REST and by the hub MCP tool). */
  async askProject(name: string, question: string): Promise<string> {
    const project = this.registry.find(name);
    if (!project) throw new Error(`no project named "${name}" is registered`);
    if (!project.enabled) throw new Error(`project "${name}" is currently disabled`);

    return this.enqueue(name, async () => {
      this.setStatus(name, "busy");
      try {
        const outcome = await this.runQuery(
          name,
          question,
          {
            cwd: project.path,
            resume: project.lastSessionId ?? undefined,
            model: project.model ?? this.config.defaults.folderModel,
            systemPrompt: briefAnswerProtocol(name),
            tools: READ_ONLY_TOOLS as any,
            allowedTools: READ_ONLY_TOOLS,
            maxTurns: this.config.defaults.maxConsultTurns,
            settingSources: ["project"],
            hooks: secretFileGuard() as any,
          },
          CONSULT_TIMEOUT_MS
        );
        this.registry.mutate(() => {
          project.lastSessionId = outcome.sessionId ?? project.lastSessionId;
        });
        this.recordProjectUsage(project, outcome.usage);
        return outcome.text;
      } finally {
        this.setStatus(name, this.registry.find(name)?.enabled ? "idle" : "off");
      }
    });
  }

  /** Generate and cache the ~200-word project summary (first enable). */
  async summarize(name: string): Promise<string> {
    const project = this.registry.find(name);
    if (!project) throw new Error(`no project named "${name}" is registered`);

    return this.enqueue(name, async () => {
      this.setStatus(name, "busy");
      try {
        const outcome = await this.runQuery(
          name,
          SUMMARIZER_PROMPT,
          {
            cwd: project.path,
            model: this.config.defaults.folderModel,
            tools: READ_ONLY_TOOLS as any,
            allowedTools: READ_ONLY_TOOLS,
            maxTurns: this.config.defaults.maxSummaryTurns,
            settingSources: ["project"],
            hooks: secretFileGuard() as any,
          },
          SUMMARY_TIMEOUT_MS
        );
        this.registry.mutate(() => {
          project.summary = outcome.text.trim();
          project.summaryGeneratedAt = new Date().toISOString();
        });
        this.recordProjectUsage(project, outcome.usage);
        bus.emit({ type: "summary.created", agent: name, summary: project.summary! });
        return project.summary!;
      } finally {
        this.setStatus(name, this.registry.find(name)?.enabled ? "idle" : "off");
      }
    });
  }

  /** One user chat message to the main agent. Streams deltas onto the bus. */
  async chat(userText: string): Promise<{ text: string; usage: Usage }> {
    if (this.chatBusy) throw new Error("the main agent is already handling a message");
    if (!this.config.workspaceRoot) throw new Error("workspace root is not configured yet");
    this.chatBusy = true;
    this.setStatus("main", "busy");
    try {
      const outcome = await this.runQuery(
        "main",
        userText,
        {
          cwd: this.config.workspaceRoot,
          resume: this.registry.mainAgent.lastSessionId ?? undefined,
          model: this.config.defaults.mainModel,
          systemPrompt: mainAgentPrompt(this.registry.projects),
          mcpServers: this.hubMcpServer ? ({ hub: this.hubMcpServer } as any) : undefined,
          tools: READ_ONLY_TOOLS as any,
          allowedTools: [...READ_ONLY_TOOLS, "mcp__hub__*"],
          maxTurns: this.config.defaults.maxChatTurns,
          settingSources: [],
          hooks: secretFileGuard() as any,
        },
        CHAT_TIMEOUT_MS,
        (text) => bus.emit({ type: "chat.delta", text })
      );
      this.registry.mutate((data) => {
        data.mainAgent.lastSessionId = outcome.sessionId ?? data.mainAgent.lastSessionId;
      });
      this.registry.addUsage(this.registry.mainAgent.usage, outcome.usage);
      bus.emit({ type: "agent.usage", agent: "main", delta: outcome.usage, total: this.registry.mainAgent.usage });
      bus.emit({ type: "chat.done", text: outcome.text, usage: outcome.usage });
      return { text: outcome.text, usage: outcome.usage };
    } catch (err) {
      bus.emit({ type: "chat.error", message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      this.chatBusy = false;
      this.setStatus("main", "idle");
    }
  }

  /** Bus helper for the hub MCP tools. */
  emitAgentMessage(from: string, to: string, kind: "question" | "answer" | "error", text: string): void {
    bus.emit({ type: "agent.message", id: crypto.randomUUID(), from, to, kind, text });
  }
}

function summarizeToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const interesting =
    obj.file_path ?? obj.pattern ?? obj.path ?? obj.project ?? obj.question ?? obj.query;
  if (typeof interesting !== "string") return undefined;
  return interesting.length > 120 ? interesting.slice(0, 117) + "..." : interesting;
}
