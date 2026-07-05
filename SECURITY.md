# Security Policy

Colony is a local-first tool; its threat model assumes the attacker is **not** on your machine but may be: any website you visit (CSRF/DNS-rebinding against localhost), malicious content inside repositories your agents read (prompt injection), or a compromised dependency.

## Built-in defenses

**Network surface**
- Server binds `127.0.0.1` only; never exposed to the LAN.
- 256-bit bearer token (generated locally, `data/.hub-token`, mode 0600) required on every API call; WebSockets authenticate via first message, never via URL.
- `Host` and `Origin` validation on every request (DNS-rebinding + CSRF).
- Strict security headers: CSP (`default-src 'self'`, no external scripts), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP/CORP.
- Request rate limiting, 64 KB body limit, 64 KB WebSocket payload cap.
- Errors return generic messages; details stay in server logs.

**Agent containment**
- Agents have **no shell access, ever**, and no network tools.
- Most agents are read-only (`Read`/`Grep`/`Glob`). Writer roles are path-jailed to their team's folder (symlinks resolved, nearest-ancestor checks for not-yet-existing files).
- Registered project paths must resolve inside your configured workspace root; credential directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.claude`, `/etc`, …) are denied outright.
- A PreToolUse hook denies reads of secret-looking files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, …) even when explicitly requested.
- Inter-agent messages are treated as data; tool handlers never interpolate them into anything executable.

**Data & supply chain**
- All runtime state (registry, token, usage) lives in gitignored `data/` with restrictive permissions; the repo ships zero credentials and zero hardcoded paths.
- Minimal dependency set, committed lockfile; run `pnpm audit` via `pnpm check`.
- Auth is your own Claude Code login or your own `ANTHROPIC_API_KEY`; neither is ever transmitted anywhere except to Anthropic by the official SDK.

## Residual risks you should know

- A prompt injection in a repo can still make an agent produce a *wrong answer* or waste tokens — containment limits it to that.
- Developer agents can modify files inside the team folder you assigned; use git so every change is reviewable and revertible.
- Anyone with local access to your machine and your `data/.hub-token` can use your Colony — protect your user account as usual.

## Reporting a vulnerability

Open a GitHub issue titled `[security]` (or email the maintainer for sensitive reports). Please include reproduction steps. Reports are welcome and appreciated.
