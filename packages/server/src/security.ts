import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Threat model: the hub is a localhost web server. The attacks that matter are
 * (1) any website the user visits scripting requests at localhost (CSRF /
 * DNS rebinding), (2) the API being used to aim an agent at a sensitive
 * directory, (3) prompt injection inside repos the agents read. This module
 * covers (1) and (2); (3) is handled by read-only agent tooling + hooks.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Vite dev server origins; the built app is same-origin so needs nothing. */
const DEV_ORIGIN_PORTS = new Set(["5173"]);

export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const idx = hostHeader.lastIndexOf(":");
  const host = idx === -1 ? hostHeader : hostHeader.slice(0, idx);
  const hostPort = idx === -1 ? "" : hostHeader.slice(idx + 1);
  return LOOPBACK_HOSTS.has(host) && (hostPort === "" || hostPort === String(port));
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  // Non-browser clients (curl) send no Origin; Host check still applies.
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (!LOOPBACK_HOSTS.has(url.hostname) && !LOOPBACK_HOSTS.has(`[${url.hostname}]`))
    return false;
  return url.port === String(port) || DEV_ORIGIN_PORTS.has(url.port);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/**
 * Fastify onRequest guard: Host + Origin validation for everything, bearer
 * token for /api/* routes. Static dashboard assets are public (they contain
 * no data; all data flows through the authenticated API).
 */
export function makeRequestGuard(token: string, port: number) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isAllowedHost(req.headers.host, port)) {
      return reply.code(403).send({ error: "forbidden host" });
    }
    if (!isAllowedOrigin(req.headers.origin, port)) {
      return reply.code(403).send({ error: "forbidden origin" });
    }
    if (req.url.startsWith("/api/")) {
      const presented = extractBearer(req);
      if (!presented || !timingSafeEqualStr(presented, token)) {
        return reply.code(401).send({ error: "missing or invalid token" });
      }
    }
  };
}

/** Directories no project path may ever resolve into, workspace root or not. */
function deniedRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".gcloud"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".kube"),
    path.join(home, ".claude"),
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library",
  ];
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type PathValidation =
  | { ok: true; realPath: string }
  | { ok: false; reason: string };

/**
 * A project path must be an existing directory that resolves (symlinks
 * followed) to somewhere strictly inside the configured workspace root,
 * and never into a denied system/credential directory.
 */
export function validateProjectPath(
  candidate: string,
  workspaceRoot: string | null
): PathValidation {
  if (!workspaceRoot) {
    return { ok: false, reason: "workspace root is not configured yet" };
  }
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    return { ok: false, reason: "invalid path" };
  }
  let realPath: string;
  let realRoot: string;
  try {
    realPath = fs.realpathSync(path.resolve(candidate));
    realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    return { ok: false, reason: "path does not exist" };
  }
  if (!fs.statSync(realPath).isDirectory()) {
    return { ok: false, reason: "path is not a directory" };
  }
  if (realPath === realRoot) {
    return { ok: false, reason: "path must be a project inside the workspace root, not the root itself" };
  }
  if (!isInside(realPath, realRoot)) {
    return { ok: false, reason: "path is outside the workspace root" };
  }
  const home = os.homedir();
  if (realPath === home) {
    return { ok: false, reason: "home directory cannot be a project" };
  }
  for (const denied of deniedRoots()) {
    if (isInside(realPath, denied) || isInside(denied, realPath)) {
      return { ok: false, reason: "path overlaps a protected directory" };
    }
  }
  return { ok: true, realPath };
}

/**
 * Workspace root itself: must exist, be a directory, not be (or contain) a
 * protected directory, and not be the filesystem root.
 */
export function validateWorkspaceRoot(candidate: string): PathValidation {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    return { ok: false, reason: "invalid path" };
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync(path.resolve(candidate));
  } catch {
    return { ok: false, reason: "path does not exist" };
  }
  if (!fs.statSync(realPath).isDirectory()) {
    return { ok: false, reason: "path is not a directory" };
  }
  if (realPath === path.parse(realPath).root) {
    return { ok: false, reason: "filesystem root cannot be the workspace" };
  }
  const home = os.homedir();
  for (const denied of deniedRoots()) {
    if (isInside(realPath, denied)) {
      return { ok: false, reason: "path is inside a protected directory" };
    }
  }
  if (realPath === home) {
    // Allowed but discouraged: warn in the route, not here.
    return { ok: true, realPath };
  }
  return { ok: true, realPath };
}

/** Filename patterns agents must never read, enforced via PreToolUse hook. */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i,
  /(^|\/)credentials(\.|$)/i,
  /(^|\/)secrets?(\.|$)/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.npmrc$/i,
  /\.keystore$/i,
  /(^|\/)serviceaccount.*\.json$/i,
];

export function isSecretFilePath(filePath: string): boolean {
  return SECRET_FILE_PATTERNS.some((re) => re.test(filePath));
}
