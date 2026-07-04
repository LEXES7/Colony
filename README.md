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

## Company mode — investor → CEO → the whole org

You are the investor; the main agent is your **CEO**. Type a venture into a team's card — *"hey, let's build an ecommerce store"* — and the pipeline runs:

1. The **PM** studies the repo and sends clarifying questions up through the CEO — they appear in your chat, and your reply goes straight back to the team.
2. PM drafts the **requirements** → you approve or send feedback.
3. The **architect** designs the solution (written to `ARCHITECTURE.md`) → you say *"start development"*.
4. PM breaks the work into ETA'd tasks across the **developers**; every finished task passes the **PR reviewer**.
5. The **QA tester** traces each requirement through the real code; the **security team** audits for vulnerabilities — findings automatically become fix tasks for the devs, then get re-audited.
6. The **CEO** inspects the result and hands you the delivery report.

Every gate pauses the pipeline and waits for your chat reply. The Teams tab shows a live step timeline; the office shows who's typing.

## Desktop app

```bash
pnpm desktop
```

Builds the dashboard and opens Colony in its own native window (Electron) — it boots the local server itself and shuts it down when you close the window. Same localhost-only security model.

## 3D office

The dashboard defaults to a **3D voxel office** (drag to orbit, scroll to zoom, click a room). Every team gets a room with a desk per member; monitors glow and characters type while agents work; envelopes fly between rooms as agents talk. Toggle to the 2D pixel view any time.

## Teams — your agent company

Create a **team** on any project folder and staff it with roles: **project manager**, **developers**, **PR reviewer**, **devops**. Then:

1. Give the team a **goal**. The PM agent explores the repo and breaks the goal into tasks — each with a title, self-contained description, an assignee, and an **ETA estimate** — created through a structured tool call (nothing parsed from prose).
2. **Run** tasks one by one or hit **Run all**. Developer agents make real file changes — but only inside the team's folder (path-jailed by a PreToolUse hook; still no shell, secrets still blocked).
3. If the team has a reviewer, finished work goes to **review**: the reviewer reads the actual changed files and either approves or sends the task back with required changes, which the developer then addresses.
4. The task board tracks status (`todo → in progress → review → done`), live ETA countdowns, overdue flags, progress notes, and per-member token usage.

The office view gives every team a room with one desk per member — watch who's typing in real time.

## Roadmap

- PM standup mode: periodic re-planning of the board against actual progress
- Task dependencies and parallel developer execution
- Git integration: branch per task, diff view in review

## License

MIT
