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

export type TeamRole =
  | "pm"
  | "developer"
  | "reviewer"
  | "devops"
  | "architect"
  | "tester"
  | "security";

export type WorkflowState =
  | "questions"
  | "awaiting_requirements"
  | "requirements"
  | "awaiting_req_approval"
  | "architecture"
  | "awaiting_arch_approval"
  | "planning"
  | "development"
  | "testing"
  | "security"
  | "fixing"
  | "delivery"
  | "done"
  | "failed";

export interface WorkflowLogEntry {
  ts: number;
  who: string; // "investor", "ceo", "pm@team", ...
  text: string;
}

export interface WorkflowPublic {
  id: string;
  teamId: string;
  prompt: string;
  state: WorkflowState;
  gateQuestion: string | null; // set while waiting on the investor
  requirements: string | null;
  architecture: string | null;
  log: WorkflowLogEntry[];
  createdAt: string;
}

export interface TeamMemberPublic {
  /** short name unique within the team, e.g. "pm", "dev-1" */
  name: string;
  role: TeamRole;
  model: string | null;
  status: AgentStatus;
  usage: Usage;
}

export interface TeamPublic {
  id: string;
  name: string;
  path: string;
  goal: string | null;
  members: TeamMemberPublic[];
  createdAt: string;
}

export type TaskStatus = "todo" | "in_progress" | "review" | "changes_requested" | "done" | "blocked";

export interface TaskPublic {
  id: string;
  teamId: string;
  title: string;
  description: string;
  assignee: string; // member name
  status: TaskStatus;
  etaMinutes: number | null;
  startedAt: string | null; // ISO; dueAt = startedAt + etaMinutes
  finishedAt: string | null;
  result: string | null; // worker's completion summary
  review: string | null; // reviewer's notes
  notes: string[]; // progress notes
  createdAt: string;
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
