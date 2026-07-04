import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project, TaskStatus, TeamRole, Usage } from "@colony/shared";
import { emptyUsage } from "@colony/shared";
import { dataDir } from "./config.js";

const usageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  estCostUsd: z.number().default(0),
  queries: z.number().default(0),
});

const projectSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  path: z.string(),
  enabled: z.boolean().default(false),
  model: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  summaryGeneratedAt: z.string().nullable().default(null),
  lastSessionId: z.string().nullable().default(null),
  usage: usageSchema.prefault({}),
});

const memberSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  role: z.enum(["pm", "developer", "reviewer", "devops"]),
  model: z.string().nullable().default(null),
  lastSessionId: z.string().nullable().default(null),
  usage: usageSchema.prefault({}),
});

const teamSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  path: z.string(),
  goal: z.string().nullable().default(null),
  members: z.array(memberSchema).default([]),
  createdAt: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  assignee: z.string(),
  status: z
    .enum(["todo", "in_progress", "review", "changes_requested", "done", "blocked"])
    .default("todo"),
  etaMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  result: z.string().nullable().default(null),
  review: z.string().nullable().default(null),
  notes: z.array(z.string()).default([]),
  createdAt: z.string(),
});

const registrySchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).default(2),
  mainAgent: z
    .object({
      lastSessionId: z.string().nullable().default(null),
      usage: usageSchema.prefault({}),
    })
    .prefault({}),
  projects: z.array(projectSchema).default([]),
  teams: z.array(teamSchema).default([]),
  tasks: z.array(taskSchema).default([]),
});

export type TeamMember = z.infer<typeof memberSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Task = z.infer<typeof taskSchema>;

export type RegistryData = z.infer<typeof registrySchema>;

const registryPath = path.join(dataDir, "registry.json");

/**
 * All mutations go through mutate() which persists atomically. Single-process
 * in-memory source of truth; the JSON file is the durable copy.
 */
export class Registry {
  private data: RegistryData;

  constructor() {
    if (fs.existsSync(registryPath)) {
      this.data = registrySchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8")));
    } else {
      this.data = registrySchema.parse({});
      this.persist();
    }
  }

  private persist(): void {
    const tmp = registryPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, registryPath);
  }

  mutate<T>(fn: (data: RegistryData) => T): T {
    const result = fn(this.data);
    this.persist();
    return result;
  }

  get projects(): Project[] {
    return this.data.projects;
  }

  get mainAgent(): RegistryData["mainAgent"] {
    return this.data.mainAgent;
  }

  find(name: string): Project | undefined {
    return this.data.projects.find((p) => p.name === name);
  }

  addProject(name: string, realPath: string): Project {
    return this.mutate((data) => {
      if (data.projects.some((p) => p.name === name)) {
        throw new Error(`project "${name}" already exists`);
      }
      if (data.projects.some((p) => p.path === realPath)) {
        throw new Error(`path already registered`);
      }
      const project: Project = {
        name,
        path: realPath,
        enabled: false,
        model: null,
        summary: null,
        summaryGeneratedAt: null,
        lastSessionId: null,
        usage: emptyUsage(),
      };
      data.projects.push(project);
      data.projects.sort((a, b) => a.name.localeCompare(b.name));
      return project;
    });
  }

  removeProject(name: string): boolean {
    return this.mutate((data) => {
      const before = data.projects.length;
      data.projects = data.projects.filter((p) => p.name !== name);
      return data.projects.length !== before;
    });
  }

  // ---- teams & tasks ----

  get teams(): Team[] {
    return this.data.teams;
  }

  get tasks(): Task[] {
    return this.data.tasks;
  }

  findTeam(id: string): Team | undefined {
    return this.data.teams.find((t) => t.id === id);
  }

  findTask(id: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }

  teamTasks(teamId: string): Task[] {
    return this.data.tasks.filter((t) => t.teamId === teamId);
  }

  addTeam(name: string, realPath: string, members: { name: string; role: TeamRole; model?: string | null }[]): Team {
    return this.mutate((data) => {
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || crypto.randomUUID().slice(0, 8);
      if (data.teams.some((t) => t.id === id)) throw new Error(`team "${id}" already exists`);
      const seen = new Set<string>();
      for (const m of members) {
        if (seen.has(m.name)) throw new Error(`duplicate member name "${m.name}"`);
        seen.add(m.name);
      }
      const team: Team = {
        id,
        name,
        path: realPath,
        goal: null,
        members: members.map((m) => ({
          name: m.name,
          role: m.role,
          model: m.model ?? null,
          lastSessionId: null,
          usage: emptyUsage(),
        })),
        createdAt: new Date().toISOString(),
      };
      data.teams.push(team);
      return team;
    });
  }

  removeTeam(id: string): boolean {
    return this.mutate((data) => {
      const before = data.teams.length;
      data.teams = data.teams.filter((t) => t.id !== id);
      data.tasks = data.tasks.filter((t) => t.teamId !== id);
      return data.teams.length !== before;
    });
  }

  addTask(input: {
    teamId: string;
    title: string;
    description: string;
    assignee: string;
    etaMinutes: number | null;
  }): Task {
    return this.mutate((data) => {
      const task: Task = {
        id: crypto.randomUUID().slice(0, 8),
        teamId: input.teamId,
        title: input.title,
        description: input.description,
        assignee: input.assignee,
        status: "todo",
        etaMinutes: input.etaMinutes,
        startedAt: null,
        finishedAt: null,
        result: null,
        review: null,
        notes: [],
        createdAt: new Date().toISOString(),
      };
      data.tasks.push(task);
      return task;
    });
  }

  updateTask(id: string, fn: (task: Task) => void): Task {
    return this.mutate((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`no task "${id}"`);
      fn(task);
      return task;
    });
  }

  removeTask(id: string): boolean {
    return this.mutate((data) => {
      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => t.id !== id);
      return data.tasks.length !== before;
    });
  }

  addUsage(target: Usage, delta: Usage): void {
    this.mutate(() => {
      target.inputTokens += delta.inputTokens;
      target.outputTokens += delta.outputTokens;
      target.cacheReadTokens += delta.cacheReadTokens;
      target.cacheCreationTokens += delta.cacheCreationTokens;
      target.estCostUsd += delta.estCostUsd;
      target.queries += delta.queries;
    });
  }
}
