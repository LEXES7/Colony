import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project, Usage } from "@colony/shared";
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

const registrySchema = z.object({
  version: z.literal(1).default(1),
  mainAgent: z
    .object({
      lastSessionId: z.string().nullable().default(null),
      usage: usageSchema.prefault({}),
    })
    .prefault({}),
  projects: z.array(projectSchema).default([]),
});

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
