# Colony

A local, security-first platform for running a **team of AI agents over your own projects**.

Register your project folders and flip each one's agent on or off. Every enabled folder gets a resident **expert agent** that knows that codebase. You chat with one **main agent**, and when your question touches another project — *"how did I implement auth in that other repo?"* — the main agent consults that project's expert directly and synthesizes the answer, with file citations.

Everything runs on your machine, with your own Claude credentials. Nothing is hosted, nothing leaves localhost.

```
you ──chat──▶ main agent ──ask_project_agent──▶ project experts (one per enabled folder)
                   │                                   │
                   └──────────── live activity feed ◀──┘
```

## Prerequisites

- Node.js ≥ 18 and [pnpm](https://pnpm.io)
- Claude credentials, either:
  - **Claude Code subscription login** (default): be logged into [Claude Code](https://claude.com/claude-code) on this machine — Colony uses that session, no API key needed; or
  - **Anthropic API key**: put `ANTHROPIC_API_KEY=sk-ant-…` in `.env` (see `.env.example`) for pay-per-token billing.

> Subscription auth is for **your own local use** on your own account. Don't host Colony for other people on top of a claude.ai login — that's against Anthropic's policy. Cost figures shown on subscription are estimates, not a bill.

## Quick start

```bash
pnpm install
pnpm dev
```

The server prints a one-time dashboard URL containing your access token:

```
Open the dashboard: http://localhost:5173/#token=xxxxxxxx…
```

Open it, then on first run set your **workspace root** — the folder that contains your projects (e.g. `~/Documents/GitHub`). Only folders inside it can be registered.

Then:

1. **Add a project** (name + absolute path) and toggle it **on**. Colony generates a ~200-word summary of the repo (cached, cheap).
2. Repeat for a second project.
3. Ask the main agent something that spans both — watch the activity feed show the agents talking to each other.

For production use: `pnpm build && pnpm start` serves the built dashboard from the server itself on `http://127.0.0.1:4173`.

## Security model

Security is the first-class design constraint, not an afterthought:

- **Loopback only** — the server binds `127.0.0.1`; other devices on your network can't reach it.
- **Token auth everywhere** — a random 256-bit token (generated on first run, stored in `data/.hub-token`, mode 0600) is required on every API call and WebSocket connection. A malicious website scripting requests at localhost gets 401s.
- **Host + Origin validation** — defeats DNS-rebinding and CSRF against the local server.
- **Path jail** — registered projects must resolve (symlinks followed) inside your configured workspace root; credential directories (`~/.ssh`, `~/.aws`, `~/.claude`, `/etc`, …) are denied outright.
- **Read-only agents** — agents get `Read`/`Grep`/`Glob` only. No shell, no file writes, no network tools. A prompt injection hidden in a repo can at worst produce a wrong answer — it cannot execute code or exfiltrate.
- **Secret-file shield** — a PreToolUse hook blocks agents from reading `.env*`, keys, credentials and similar files even if asked.
- **Nothing sensitive in the repo** — all runtime state (registry, token, usage) lives in the gitignored `data/`; there are no hardcoded paths or credentials.

## Token-usage optimization

- **Model tiering** — project experts and summaries run on `claude-haiku-4-5`; the main agent defaults to `claude-sonnet-4-6` (change in `data/config.json`).
- **Summary cache** — the main agent sees a short cached summary per project, never whole codebases.
- **Session resume** — repeat questions to an expert reuse its previous session instead of re-exploring the repo.
- **Brief-answer protocol** — experts answer in <150 words with file citations, no code dumps unless asked.
- **Turn caps** — consults, summaries and chats each have hard turn limits.
- **Lazy agents** — an idle agent is just a session-id string in the registry; no processes at rest.
- **Live counters** — per-agent token/cache/cost counters in the dashboard so you see exactly what everything costs.

## Configuration

`data/config.json` (created on first run):

| key | default | meaning |
|---|---|---|
| `port` | `4173` | server port (loopback) |
| `workspaceRoot` | `null` | folder your projects live in — set during onboarding |
| `defaults.folderModel` | `claude-haiku-4-5` | model for project experts + summaries |
| `defaults.mainModel` | `claude-sonnet-4-6` | model for the main agent |
| `defaults.maxConsultTurns` | `8` | turn cap per expert consult |

Per-project model overrides are available in the dashboard.

## Roadmap

v2: role-based teams on the same message bus — a project manager, PR reviewer, developers and devops agents collaborating on a single project. The v1 architecture (agents addressed by id, role-agnostic bus, per-agent tool policies) is built for it.

## License

MIT
