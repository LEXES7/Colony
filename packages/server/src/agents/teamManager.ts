import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TaskPublic, TeamPublic } from "@colony/shared";
import type { AgentManager } from "./agentManager.js";
import { bus } from "../bus.js";
import type { HubConfig } from "../config.js";
import type { Registry, Task, Team, TeamMember } from "../registry.js";
import { isPathInsideJail, isSecretFilePath } from "../security.js";
import { pmPlanPrompt, reviewerTaskPrompt, workerTaskPrompt, type TeamContext } from "./prompts.js";

const READ_TOOLS = ["Read", "Grep", "Glob"];
const WRITE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"];

const PLAN_TIMEOUT_MS = 420_000;
const WORK_TIMEOUT_MS = 1_500_000;
const REVIEW_TIMEOUT_MS = 420_000;

const PLAN_MAX_TURNS = 24;
const WORK_MAX_TURNS = 50;
const REVIEW_MAX_TURNS = 20;

export class TeamManager {
  private runAllActive = new Set<string>();

  constructor(
    private registry: Registry,
    private config: HubConfig,
    private agents: AgentManager
  ) {}

  agentId(team: Team, member: TeamMember): string {
    return `${member.name}@${team.id}`;
  }

  toPublicTeams(): TeamPublic[] {
    return this.registry.teams.map((team) => ({
      id: team.id,
      name: team.name,
      path: team.path,
      goal: team.goal,
      createdAt: team.createdAt,
      members: team.members.map((m) => ({
        name: m.name,
        role: m.role,
        model: m.model,
        status: this.agents.statusOf(this.agentId(team, m)),
        usage: m.usage,
      })),
    }));
  }

  toPublicTask(task: Task): TaskPublic {
    return { ...task };
  }

  private broadcastTeams(): void {
    bus.emit({ type: "teams.updated", teams: this.toPublicTeams() });
  }

  private broadcastTask(task: Task): void {
    bus.emit({ type: "task.updated", task: this.toPublicTask(task) });
  }

  private ctxOf(team: Team): TeamContext {
    return {
      teamName: team.name,
      goal: team.goal ?? "(no goal set)",
      roster: team.members.map((m) => ({ name: m.name, role: m.role })),
    };
  }

  private memberOf(team: Team, name: string): TeamMember {
    const member = team.members.find((m) => m.name === name);
    if (!member) throw new Error(`team "${team.id}" has no member "${name}"`);
    return member;
  }

  private modelFor(member: TeamMember): string {
    return member.model ?? this.config.defaults.mainModel;
  }

  /** Jail Read/Edit/Write to the team folder + keep secrets unreadable. */
  private fileGuard(team: Team) {
    return {
      PreToolUse: [
        {
          matcher: "Read|Edit|Write",
          hooks: [
            async (input: unknown) => {
              const toolInput = (input as { tool_input?: { file_path?: string } }).tool_input;
              const filePath = toolInput?.file_path ?? "";
              const deny = (reason: string) => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: reason,
                },
              });
              if (isSecretFilePath(filePath)) {
                return deny("Colony blocks agents from touching secret files (.env, keys, credentials).");
              }
              if (!isPathInsideJail(filePath, team.path)) {
                return deny(`Colony blocks file access outside the team folder (${team.path}).`);
              }
              return {};
            },
          ],
        },
      ],
    };
  }

  private emitMsg(from: string, to: string, kind: "question" | "answer" | "error", text: string): void {
    this.agents.emitAgentMessage(from, to, kind, text);
  }

  /**
   * One member query. Serialized per member via the AgentManager queue so a
   * member never runs two sessions at once; different members run in parallel.
   */
  private async runMember(
    team: Team,
    member: TeamMember,
    prompt: string,
    opts: {
      tools: string[];
      extraAllowed?: string[];
      mcpServers?: Record<string, unknown>;
      maxTurns: number;
      timeoutMs: number;
      resume?: boolean;
    }
  ): Promise<string> {
    const id = this.agentId(team, member);
    return this.agents.runForAgent(id, prompt, {
      cwd: team.path,
      resume: opts.resume ? (member.lastSessionId ?? undefined) : undefined,
      model: this.modelFor(member),
      tools: opts.tools as never,
      allowedTools: [...opts.tools, ...(opts.extraAllowed ?? [])],
      mcpServers: opts.mcpServers as never,
      maxTurns: opts.maxTurns,
      settingSources: ["project"],
      hooks: this.fileGuard(team) as never,
      permissionMode: "default",
    }, opts.timeoutMs, (outcome) => {
      this.registry.mutate(() => {
        member.lastSessionId = outcome.sessionId ?? member.lastSessionId;
      });
      this.registry.addUsage(member.usage, outcome.usage);
      bus.emit({ type: "agent.usage", agent: id, delta: outcome.usage, total: member.usage });
    });
  }

  /** PM plans the goal into tasks (created via the create_task tool). */
  async plan(teamId: string, goal: string): Promise<{ summary: string; tasks: TaskPublic[] }> {
    const team = this.registry.findTeam(teamId);
    if (!team) throw new Error(`no team "${teamId}"`);
    const pm = team.members.find((m) => m.role === "pm");
    if (!pm) throw new Error(`team "${team.name}" has no PM — add a pm member to plan`);

    this.registry.mutate(() => {
      team.goal = goal;
    });
    this.broadcastTeams();

    const created: Task[] = [];
    const assignable = new Set(
      team.members.filter((m) => m.role === "developer" || m.role === "devops").map((m) => m.name)
    );
    if (assignable.size === 0) throw new Error(`team "${team.name}" needs at least one developer/devops`);

    const pmId = this.agentId(team, pm);
    const teamServer = createSdkMcpServer({
      name: "team",
      version: "1.0.0",
      tools: [
        tool(
          "create_task",
          "Create one task on the team board. Call once per task, in execution order.",
          {
            title: z.string().min(3).max(200),
            description: z.string().min(10).max(4000).describe("Self-contained: files, acceptance criteria"),
            assignee: z.string().describe(`Member name; one of: ${[...assignable].join(", ")}`),
            eta_minutes: z.number().int().min(5).max(60 * 24 * 7).describe("Realistic focused-work estimate"),
          },
          async ({ title, description, assignee, eta_minutes }) => {
            if (!assignable.has(assignee)) {
              return {
                content: [{ type: "text" as const, text: `"${assignee}" is not an assignable member. Use: ${[...assignable].join(", ")}` }],
                isError: true,
              };
            }
            const task = this.registry.addTask({
              teamId: team.id,
              title,
              description,
              assignee,
              etaMinutes: eta_minutes,
            });
            created.push(task);
            this.broadcastTask(task);
            this.emitMsg(pmId, `${assignee}@${team.id}`, "question", `New task (ETA ${eta_minutes}m): ${title}`);
            return { content: [{ type: "text" as const, text: `created task ${task.id}` }] };
          }
        ),
      ],
    });

    const summary = await this.runMember(team, pm, pmPlanPrompt(this.ctxOf(team)), {
      tools: READ_TOOLS,
      extraAllowed: ["mcp__team__*"],
      mcpServers: { team: teamServer },
      maxTurns: PLAN_MAX_TURNS,
      timeoutMs: PLAN_TIMEOUT_MS,
    });

    if (created.length === 0) throw new Error("the PM finished without creating any tasks — try a more concrete goal");
    this.broadcastTeams();
    return { summary, tasks: created.map((t) => this.toPublicTask(t)) };
  }

  /** Run one task with its assignee (developer/devops get write access). */
  async runTask(taskId: string): Promise<TaskPublic> {
    const task = this.registry.findTask(taskId);
    if (!task) throw new Error(`no task "${taskId}"`);
    const team = this.registry.findTeam(task.teamId);
    if (!team) throw new Error(`task "${taskId}" has no team`);
    const member = this.memberOf(team, task.assignee);
    if (task.status === "in_progress" || task.status === "review") {
      throw new Error(`task is already ${task.status}`);
    }

    const reworkNotes = task.status === "changes_requested" ? task.review : null;
    this.registry.updateTask(task.id, (t) => {
      t.status = "in_progress";
      t.startedAt = new Date().toISOString();
      t.finishedAt = null;
    });
    this.broadcastTask(task);

    const memberId = this.agentId(team, member);
    const teamServer = createSdkMcpServer({
      name: "team",
      version: "1.0.0",
      tools: [
        tool(
          "report_progress",
          "Log a short progress note on your current task.",
          { note: z.string().min(3).max(500) },
          async ({ note }) => {
            this.registry.updateTask(task.id, (t) => {
              t.notes.push(note);
            });
            this.broadcastTask(task);
            this.emitMsg(memberId, `pm-board@${team.id}`, "answer", note);
            return { content: [{ type: "text" as const, text: "noted" }] };
          }
        ),
        tool(
          "mark_blocked",
          "Mark your current task blocked and stop working. Use only when truly stuck.",
          { reason: z.string().min(3).max(1000) },
          async ({ reason }) => {
            this.registry.updateTask(task.id, (t) => {
              t.status = "blocked";
              t.notes.push(`BLOCKED: ${reason}`);
            });
            this.broadcastTask(task);
            this.emitMsg(memberId, `pm-board@${team.id}`, "error", `blocked: ${reason}`);
            return { content: [{ type: "text" as const, text: "task marked blocked — stop now and summarize why" }] };
          }
        ),
      ],
    });

    const canWrite = member.role === "developer" || member.role === "devops";
    try {
      const result = await this.runMember(
        team,
        member,
        workerTaskPrompt(this.ctxOf(team), this.toPublicTask(task), this.registry.teamTasks(team.id).map((t) => this.toPublicTask(t)), reworkNotes),
        {
          tools: canWrite ? WRITE_TOOLS : READ_TOOLS,
          extraAllowed: ["mcp__team__*"],
          mcpServers: { team: teamServer },
          maxTurns: WORK_MAX_TURNS,
          timeoutMs: WORK_TIMEOUT_MS,
          resume: false,
        }
      );

      const hasReviewer = team.members.some((m) => m.role === "reviewer");
      this.registry.updateTask(task.id, (t) => {
        if (t.status === "blocked") return; // mark_blocked wins
        t.result = result;
        t.status = hasReviewer ? "review" : "done";
        t.finishedAt = new Date().toISOString();
      });
      this.broadcastTask(task);
      this.emitMsg(memberId, `pm-board@${team.id}`, "answer", `finished: ${task.title}`);
      return this.toPublicTask(task);
    } catch (err) {
      this.registry.updateTask(task.id, (t) => {
        t.status = "blocked";
        t.notes.push(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      });
      this.broadcastTask(task);
      throw err;
    }
  }

  /** Reviewer verifies a task in "review" and approves or requests changes. */
  async reviewTask(taskId: string): Promise<TaskPublic> {
    const task = this.registry.findTask(taskId);
    if (!task) throw new Error(`no task "${taskId}"`);
    const team = this.registry.findTeam(task.teamId);
    if (!team) throw new Error(`task has no team`);
    const reviewer = team.members.find((m) => m.role === "reviewer");
    if (!reviewer) throw new Error(`team "${team.name}" has no reviewer`);
    if (task.status !== "review") throw new Error(`task is ${task.status}, not review`);

    const reviewerId = this.agentId(team, reviewer);
    let verdictGiven = false;
    const teamServer = createSdkMcpServer({
      name: "team",
      version: "1.0.0",
      tools: [
        tool(
          "approve_task",
          "Approve the task under review as done.",
          { notes: z.string().max(1500).default("") },
          async ({ notes }) => {
            verdictGiven = true;
            this.registry.updateTask(task.id, (t) => {
              t.status = "done";
              t.review = notes || "approved";
              t.finishedAt = new Date().toISOString();
            });
            this.broadcastTask(task);
            this.emitMsg(reviewerId, `${task.assignee}@${team.id}`, "answer", `approved: ${task.title}`);
            return { content: [{ type: "text" as const, text: "approved" }] };
          }
        ),
        tool(
          "request_changes",
          "Send the task back to its assignee with specific required changes.",
          { notes: z.string().min(10).max(1500) },
          async ({ notes }) => {
            verdictGiven = true;
            this.registry.updateTask(task.id, (t) => {
              t.status = "changes_requested";
              t.review = notes;
            });
            this.broadcastTask(task);
            this.emitMsg(reviewerId, `${task.assignee}@${team.id}`, "question", `changes requested: ${notes.slice(0, 200)}`);
            return { content: [{ type: "text" as const, text: "changes requested" }] };
          }
        ),
      ],
    });

    await this.runMember(team, reviewer, reviewerTaskPrompt(this.ctxOf(team), this.toPublicTask(task)), {
      tools: READ_TOOLS,
      extraAllowed: ["mcp__team__*"],
      mcpServers: { team: teamServer },
      maxTurns: REVIEW_MAX_TURNS,
      timeoutMs: REVIEW_TIMEOUT_MS,
      resume: false,
    });

    if (!verdictGiven) {
      this.registry.updateTask(task.id, (t) => {
        t.notes.push("reviewer gave no verdict — left in review");
      });
      this.broadcastTask(task);
    }
    return this.toPublicTask(this.registry.findTask(taskId)!);
  }

  /**
   * Run the whole board: todo/changes_requested tasks in creation order,
   * one at a time (they share a working tree), reviewing after each when a
   * reviewer exists. Fire-and-forget; progress arrives via bus events.
   */
  async runAll(teamId: string): Promise<void> {
    const team = this.registry.findTeam(teamId);
    if (!team) throw new Error(`no team "${teamId}"`);
    if (this.runAllActive.has(teamId)) throw new Error("run-all is already in progress for this team");
    this.runAllActive.add(teamId);
    try {
      // re-read each iteration: reviews can send tasks back to the queue
      for (let guard = 0; guard < 50; guard++) {
        const next = this.registry
          .teamTasks(teamId)
          .find((t) => t.status === "todo" || t.status === "changes_requested");
        if (!next) break;
        await this.runTask(next.id);
        const after = this.registry.findTask(next.id);
        if (after?.status === "review") {
          await this.reviewTask(next.id);
        }
        if (this.registry.findTask(next.id)?.status === "blocked") break; // stop the line on failure
      }
    } finally {
      this.runAllActive.delete(teamId);
    }
  }
}
