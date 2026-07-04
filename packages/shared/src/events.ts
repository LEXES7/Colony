import type {
  AgentStatus,
  ProjectPublic,
  TaskPublic,
  TeamPublic,
  Usage,
  WorkflowPublic,
} from "./types.js";

export type HubEvent =
  | { type: "chat.delta"; text: string; ts: number }
  | { type: "chat.done"; text: string; usage: Usage; ts: number }
  | { type: "chat.error"; message: string; ts: number }
  | { type: "agent.status"; agent: string; status: AgentStatus; ts: number }
  | {
      type: "agent.message";
      id: string;
      from: string;
      to: string;
      kind: "question" | "answer" | "error";
      text: string;
      ts: number;
    }
  | { type: "agent.tool"; agent: string; tool: string; detail?: string; ts: number }
  | { type: "agent.usage"; agent: string; delta: Usage; total: Usage; ts: number }
  | { type: "summary.created"; agent: string; summary: string; ts: number }
  | { type: "registry.updated"; projects: ProjectPublic[]; ts: number }
  | { type: "teams.updated"; teams: TeamPublic[]; ts: number }
  | { type: "task.updated"; task: TaskPublic; ts: number }
  | { type: "task.deleted"; taskId: string; ts: number }
  | { type: "workflow.updated"; workflow: WorkflowPublic; ts: number };

export type HubEventType = HubEvent["type"];
