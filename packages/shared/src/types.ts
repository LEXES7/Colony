export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estCostUsd: number;
  queries: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  estCostUsd: 0,
  queries: 0,
});

/**
 * v1 roles. v2 adds "pm" | "developer" | "reviewer" | "devops" — everything
 * downstream (bus, manager, tools) addresses agents by id, never by role.
 */
export type AgentRole = "main" | "project-expert";

export interface AgentSpec {
  id: string;
  role: AgentRole;
  cwd: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  maxTurns: number;
  lastSessionId: string | null;
}

export type AgentStatus = "off" | "idle" | "busy";

export interface Project {
  name: string;
  path: string;
  enabled: boolean;
  model: string | null;
  summary: string | null;
  summaryGeneratedAt: string | null;
  lastSessionId: string | null;
  usage: Usage;
}

/** Project fields safe to send to the dashboard. */
export interface ProjectPublic {
  name: string;
  path: string;
  enabled: boolean;
  model: string | null;
  summary: string | null;
  summaryGeneratedAt: string | null;
  status: AgentStatus;
  usage: Usage;
}

export interface HubDefaults {
  folderModel: string;
  mainModel: string;
  maxConsultTurns: number;
}

export interface ChatResponse {
  text: string;
  usage: Usage;
}
