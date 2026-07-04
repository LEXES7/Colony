import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (packages/server/src -> repo). */
export const rootDir = path.resolve(__dirname, "..", "..", "..");
export const dataDir = path.join(rootDir, "data");
export const webDistDir = path.join(rootDir, "packages", "web", "dist");

const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(4173),
  /**
   * Root directory that registered projects must live inside. null until the
   * user completes setup — no agents can be registered before that.
   */
  workspaceRoot: z.string().nullable().default(null),
  defaults: z
    .object({
      folderModel: z.string().default("claude-haiku-4-5"),
      mainModel: z.string().default("claude-sonnet-4-6"),
      maxConsultTurns: z.number().int().min(1).max(50).default(8),
      maxChatTurns: z.number().int().min(1).max(100).default(25),
      maxSummaryTurns: z.number().int().min(1).max(50).default(12),
    })
    .prefault({}),
});

export type HubConfig = z.infer<typeof configSchema>;

const configPath = path.join(dataDir, "config.json");
const tokenPath = path.join(dataDir, ".hub-token");

function ensureDataDir(): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
}

export function loadConfig(): HubConfig {
  ensureDataDir();
  if (!fs.existsSync(configPath)) {
    const fresh = configSchema.parse({});
    fs.writeFileSync(configPath, JSON.stringify(fresh, null, 2), { mode: 0o600 });
    return fresh;
  }
  return configSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

export function saveConfig(config: HubConfig): void {
  ensureDataDir();
  const tmp = configPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

/** Load or create the dashboard auth token (256-bit, hex). */
export function loadToken(): string {
  ensureDataDir();
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    if (token.length >= 32) return token;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  return token;
}
