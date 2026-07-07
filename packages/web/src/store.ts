import { create } from "zustand";
import type {
  HubEvent,
  ProjectPublic,
  TaskPublic,
  TeamPublic,
  Usage,
  WorkflowPublic,
} from "@colony/shared";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  ts: number;
}

export interface ActivityItem {
  id: string;
  from: string;
  to: string;
  kind: "question" | "answer" | "error" | "tool" | "summary";
  text: string;
  ts: number;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "warn" | "error";
  text: string;
}

interface HubState {
  toasts: Toast[];
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  token: string | null;
  connected: boolean;
  setupComplete: boolean | null;
  workspaceRoot: string | null;
  projects: ProjectPublic[];
  teams: TeamPublic[];
  tasks: TaskPublic[];
  workflows: WorkflowPublic[];
  statuses: Record<string, string>;
  chat: ChatMessage[];
  streaming: string;
  chatBusy: boolean;
  activity: ActivityItem[];
  mainUsage: Usage | null;

  setToken: (t: string | null) => void;
  setConnected: (c: boolean) => void;
  setConfig: (setupComplete: boolean, workspaceRoot: string | null) => void;
  setProjects: (p: ProjectPublic[]) => void;
  setTeams: (teams: TeamPublic[], tasks: TaskPublic[], workflows?: WorkflowPublic[]) => void;
  addUserMessage: (text: string) => void;
  setChatBusy: (b: boolean) => void;
  applyEvent: (e: HubEvent) => void;
}

let activitySeq = 0;
const aid = () => `a${++activitySeq}`;
let toastSeq = 0;

/** Human wording for pipeline states worth interrupting the user about. */
function workflowToast(state: string, team: string): { kind: Toast["kind"]; text: string } | null {
  if (state.startsWith("awaiting")) return { kind: "warn", text: `${team} needs your answer — reply in the chat` };
  if (state === "done") return { kind: "success", text: `${team} delivered — the venture is complete` };
  if (state === "failed") return { kind: "error", text: `${team} hit a problem — press Resume to continue` };
  if (state === "testing") return { kind: "info", text: `${team}: build finished, testing has started` };
  if (state === "security") return { kind: "info", text: `${team}: security audit underway` };
  return null;
}

export const useHub = create<HubState>((set) => ({
  toasts: [],
  pushToast: (kind, text) =>
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id: ++toastSeq, kind, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  token: null,
  connected: false,
  setupComplete: null,
  workspaceRoot: null,
  projects: [],
  teams: [],
  tasks: [],
  workflows: [],
  statuses: {},
  chat: [],
  streaming: "",
  chatBusy: false,
  activity: [],
  mainUsage: null,

  setToken: (token) => set({ token }),
  setConnected: (connected) => set({ connected }),
  setConfig: (setupComplete, workspaceRoot) => set({ setupComplete, workspaceRoot }),
  setProjects: (projects) => set({ projects }),
  setTeams: (teams, tasks, workflows) =>
    set((s) => ({ teams, tasks, workflows: workflows ?? s.workflows })),
  addUserMessage: (text) =>
    set((s) => ({ chat: [...s.chat, { role: "user", text, ts: Date.now() }], streaming: "" })),
  setChatBusy: (chatBusy) => set({ chatBusy }),

  applyEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case "chat.delta":
          return { streaming: s.streaming + e.text };
        case "chat.done":
          return {
            chat: [...s.chat, { role: "assistant", text: e.text, ts: e.ts }],
            streaming: "",
            chatBusy: false,
          };
        case "chat.error":
          return {
            chat: [...s.chat, { role: "error", text: e.message, ts: e.ts }],
            streaming: "",
            chatBusy: false,
          };
        case "registry.updated":
          return { projects: e.projects };
        case "teams.updated":
          return { teams: e.teams };
        case "task.updated": {
          const prevTask = s.tasks.find((t) => t.id === e.task.id);
          let toasts = s.toasts;
          if (prevTask && prevTask.status !== e.task.status && e.task.status === "blocked") {
            toasts = [...toasts.slice(-3), { id: ++toastSeq, kind: "warn" as const, text: `Task blocked: ${e.task.title}` }];
          }
          return {
            toasts,
            tasks: prevTask ? s.tasks.map((t) => (t.id === e.task.id ? e.task : t)) : [...s.tasks, e.task],
          };
        }
        case "task.deleted":
          return { tasks: s.tasks.filter((t) => t.id !== e.taskId) };
        case "workflow.updated": {
          const prev = s.workflows.find((w) => w.id === e.workflow.id);
          const exists = Boolean(prev);
          let toasts = s.toasts;
          if (prev?.state !== e.workflow.state) {
            const team = s.teams.find((t) => t.id === e.workflow.teamId)?.name ?? e.workflow.teamId;
            const toast = workflowToast(e.workflow.state, team);
            if (toast) toasts = [...toasts.slice(-3), { id: ++toastSeq, ...toast }];
          }
          return {
            toasts,
            workflows: exists
              ? s.workflows.map((w) => (w.id === e.workflow.id ? e.workflow : w))
              : [...s.workflows, e.workflow],
          };
        }
        case "agent.status":
          return { statuses: { ...s.statuses, [e.agent]: e.status } };
        case "agent.message":
          return {
            activity: [
              ...s.activity.slice(-199),
              { id: e.id, from: e.from, to: e.to, kind: e.kind, text: e.text, ts: e.ts },
            ],
          };
        case "agent.tool":
          return {
            activity: [
              ...s.activity.slice(-199),
              {
                id: aid(),
                from: e.agent,
                to: "",
                kind: "tool",
                text: `${e.tool}${e.detail ? `: ${e.detail}` : ""}`,
                ts: e.ts,
              },
            ],
          };
        case "summary.created":
          return {
            activity: [
              ...s.activity.slice(-199),
              { id: aid(), from: e.agent, to: "", kind: "summary", text: "summary generated", ts: e.ts },
            ],
          };
        case "agent.usage": {
          if (e.agent === "main") return { mainUsage: e.total };
          return {
            projects: s.projects.map((p) => (p.name === e.agent ? { ...p, usage: e.total } : p)),
          };
        }
        default:
          return {};
      }
    }),
}));
