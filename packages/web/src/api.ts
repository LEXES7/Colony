import { useHub } from "./store";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useHub.getState().token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export interface ConfigResponse {
  workspaceRoot: string | null;
  setupComplete: boolean;
  defaults?: { folderModel: string; mainModel: string; maxConsultTurns: number };
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  getConfig: () => request<ConfigResponse>("/api/config"),
  patchConfig: (body: { workspaceRoot?: string; folderModel?: string; mainModel?: string }) =>
    request<{ ok: boolean }>("/api/config", { method: "PATCH", body: JSON.stringify(body) }),
  setWorkspaceRoot: (workspaceRoot: string) =>
    request<{ ok: boolean }>("/api/config", {
      method: "PATCH",
      body: JSON.stringify({ workspaceRoot }),
    }),
  listProjects: () => request<import("@colony/shared").ProjectPublic[]>("/api/projects"),
  addProject: (name: string, path: string) =>
    request<{ ok: boolean }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),
  patchProject: (name: string, body: { enabled?: boolean; model?: string | null; resetSession?: boolean }) =>
    request<{ ok: boolean }>(`/api/projects/${name}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteProject: (name: string) =>
    request<{ ok: boolean }>(`/api/projects/${name}`, { method: "DELETE" }),
  summarize: (name: string) =>
    request<{ summary: string }>(`/api/projects/${name}/summarize`, { method: "POST", body: "{}" }),
  chat: (message: string) =>
    request<{ text: string }>("/api/chat", { method: "POST", body: JSON.stringify({ message }) }),

  // teams & tasks
  listTeams: () =>
    request<{
      teams: import("@colony/shared").TeamPublic[];
      tasks: import("@colony/shared").TaskPublic[];
      workflows: import("@colony/shared").WorkflowPublic[];
    }>("/api/teams"),
  startWorkflow: (teamId: string, prompt: string) =>
    request<import("@colony/shared").WorkflowPublic>(`/api/teams/${teamId}/workflow`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  createTeam: (body: {
    name: string;
    path: string;
    members: { name: string; role: import("@colony/shared").TeamRole; model?: string | null }[];
  }) => request<{ id: string }>("/api/teams", { method: "POST", body: JSON.stringify(body) }),
  deleteTeam: (id: string) => request<{ ok: boolean }>(`/api/teams/${id}`, { method: "DELETE" }),
  planTeam: (id: string, goal: string) =>
    request<{ summary: string }>(`/api/teams/${id}/plan`, {
      method: "POST",
      body: JSON.stringify({ goal }),
    }),
  runAll: (id: string) => request<{ ok: boolean }>(`/api/teams/${id}/run-all`, { method: "POST", body: "{}" }),
  runTask: (id: string) => request<unknown>(`/api/tasks/${id}/run`, { method: "POST", body: "{}" }),
  reviewTask: (id: string) => request<unknown>(`/api/tasks/${id}/review`, { method: "POST", body: "{}" }),
  patchTask: (id: string, body: { status?: string; etaMinutes?: number | null; assignee?: string }) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
};
