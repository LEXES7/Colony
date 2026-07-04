import { create } from "zustand";
import type { HubEvent, ProjectPublic, TaskPublic, TeamPublic, Usage } from "@colony/shared";

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

interface HubState {
  token: string | null;
  connected: boolean;
  setupComplete: boolean | null;
  workspaceRoot: string | null;
  projects: ProjectPublic[];
  teams: TeamPublic[];
  tasks: TaskPublic[];
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
  setTeams: (teams: TeamPublic[], tasks: TaskPublic[]) => void;
  addUserMessage: (text: string) => void;
  setChatBusy: (b: boolean) => void;
  applyEvent: (e: HubEvent) => void;
}

let activitySeq = 0;
const aid = () => `a${++activitySeq}`;

export const useHub = create<HubState>((set) => ({
  token: null,
  connected: false,
  setupComplete: null,
  workspaceRoot: null,
  projects: [],
  teams: [],
  tasks: [],
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
  setTeams: (teams, tasks) => set({ teams, tasks }),
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
          const exists = s.tasks.some((t) => t.id === e.task.id);
          return {
            tasks: exists ? s.tasks.map((t) => (t.id === e.task.id ? e.task : t)) : [...s.tasks, e.task],
          };
        }
        case "task.deleted":
          return { tasks: s.tasks.filter((t) => t.id !== e.taskId) };
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
