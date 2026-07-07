import type { WorkflowPublic } from "@colony/shared";
import { bus } from "../bus.js";
import type { Registry, Team, TeamMember, Workflow } from "../registry.js";
import type { AgentManager } from "./agentManager.js";
import type { TeamManager } from "./teamManager.js";

const READ_TOOLS = ["Read", "Grep", "Glob"];
const WRITE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"];
const APPROVAL = /^(yes|yep|ok|okay|approved?|looks good|lgtm|go|go ahead|start|start development|proceed|ship it)\b/i;

/**
 * The company pipeline:
 *   investor prompt → PM questions (CEO relays) → investor answers
 *   → requirements doc → investor approval → architecture → investor approval
 *   → PM plans tasks → developers build (+ per-task review) → tester verifies
 *   → security audit (findings become fix tasks, one re-audit) → CEO delivery.
 *
 * While a gate is open, the next chat message from the user is routed here
 * instead of the normal main-agent chat.
 */
export class WorkflowManager {
  constructor(
    private registry: Registry,
    private agents: AgentManager,
    private teams: TeamManager
  ) {}

  toPublic(wf: Workflow): WorkflowPublic {
    return { ...wf };
  }

  private broadcast(wf: Workflow): void {
    bus.emit({ type: "workflow.updated", workflow: this.toPublic(wf) });
  }

  private log(wf: Workflow, who: string, text: string): void {
    this.registry.updateWorkflow(wf.id, (w) => {
      w.log.push({ ts: Date.now(), who, text: text.slice(0, 4000) });
    });
    this.broadcast(wf);
  }

  private setState(wf: Workflow, state: Workflow["state"], gateQuestion: string | null = null): void {
    this.registry.updateWorkflow(wf.id, (w) => {
      w.state = state;
      w.gateQuestion = gateQuestion;
    });
    this.broadcast(wf);
  }

  /** CEO speaks into the main chat pane (no LLM call — deterministic relay). */
  private ceoSay(text: string): void {
    bus.emit({ type: "chat.done", text, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, estCostUsd: 0, queries: 0 } });
  }

  /** The single open gate, if any (most recent workflow waiting on the user). */
  activeGate(): Workflow | null {
    const waiting = this.registry.workflows.filter((w) =>
      ["awaiting_requirements", "awaiting_req_approval", "awaiting_arch_approval"].includes(w.state)
    );
    return waiting.length ? waiting[waiting.length - 1]! : null;
  }

  private teamOf(wf: Workflow): Team {
    const team = this.registry.findTeam(wf.teamId);
    if (!team) throw new Error(`workflow team "${wf.teamId}" is gone`);
    return team;
  }

  private member(team: Team, role: TeamMember["role"]): TeamMember | undefined {
    return team.members.find((m) => m.role === role);
  }

  private async ask(
    team: Team,
    member: TeamMember,
    prompt: string,
    opts: { write?: boolean; maxTurns?: number; timeoutMs?: number } = {}
  ): Promise<string> {
    const id = `${member.name}@${team.id}`;
    return this.agents.runForAgent(
      id,
      prompt,
      {
        cwd: team.path,
        model: member.model ?? undefined,
        tools: (opts.write ? WRITE_TOOLS : READ_TOOLS) as never,
        allowedTools: opts.write ? WRITE_TOOLS : READ_TOOLS,
        maxTurns: opts.maxTurns ?? 20,
        settingSources: ["project"],
        permissionMode: "default",
      },
      opts.timeoutMs ?? 600_000,
      (outcome) => {
        this.registry.mutate(() => {
          member.lastSessionId = outcome.sessionId ?? member.lastSessionId;
        });
        this.registry.addUsage(member.usage, outcome.usage);
        bus.emit({ type: "agent.usage", agent: id, delta: outcome.usage, total: member.usage });
      }
    );
  }

  /** Kick off: PM prepares clarifying questions for the investor. */
  async start(teamId: string, prompt: string): Promise<WorkflowPublic> {
    const team = this.registry.findTeam(teamId);
    if (!team) throw new Error(`no team "${teamId}"`);
    const pm = this.member(team, "pm");
    if (!pm) throw new Error("this team needs a PM for company mode");
    if (!team.members.some((m) => m.role === "developer" || m.role === "devops")) {
      throw new Error("this team needs at least one developer");
    }

    const wf = this.registry.addWorkflow(teamId, prompt);
    this.log(wf, "investor", prompt);
    this.registry.mutate(() => {
      team.goal = prompt;
    });

    void this.phaseQuestions(wf.id).catch((err) => this.fail(wf.id, err));
    return this.toPublic(this.registry.findWorkflow(wf.id)!);
  }

  private fail(wfId: string, err: unknown): void {
    const wf = this.registry.findWorkflow(wfId);
    if (!wf) return;
    const msg = err instanceof Error ? err.message : String(err);
    const phase = wf.state;
    this.registry.updateWorkflow(wf.id, (w) => {
      w.resumeFrom = phase;
    });
    this.log(wf, "system", `FAILED during ${phase}: ${msg}`);
    this.setState(wf, "failed");
    this.ceoSay(
      `The ${this.teamOf(wf).name} team hit a problem during ${phase.replace(/_/g, " ")}: ${msg}\n\nNothing is lost — say "resume" (or press Resume on the team card) and they'll pick up right where they stopped.`
    );
  }

  /**
   * Crash recovery, called once at server startup: any workflow that was
   * mid-phase when the process died is marked failed-but-resumable, and
   * tasks orphaned in_progress go back to todo.
   */
  recoverInterrupted(): void {
    const RUNNING: Workflow["state"][] = [
      "questions", "requirements", "architecture", "planning",
      "development", "testing", "security", "fixing", "delivery",
    ];
    for (const wf of this.registry.workflows) {
      if (!RUNNING.includes(wf.state)) continue;
      const phase = wf.state;
      this.registry.updateWorkflow(wf.id, (w) => {
        w.resumeFrom = phase;
        w.state = "failed";
        w.log.push({ ts: Date.now(), who: "system", text: `interrupted by a restart during ${phase} — resumable` });
      });
    }
    for (const task of this.registry.tasks) {
      if (task.status === "in_progress") {
        this.registry.updateTask(task.id, (t) => {
          t.status = "todo";
          t.notes.push("reset after restart");
        });
      }
    }
  }

  /** Latest failed workflow for a team (or overall) that can be resumed. */
  findResumable(teamId?: string): Workflow | null {
    const failed = this.registry.workflows.filter(
      (w) => w.state === "failed" && (!teamId || w.teamId === teamId)
    );
    return failed.length ? failed[failed.length - 1]! : null;
  }

  /** Re-enter the pipeline at the phase where it failed. */
  async resume(wfId: string): Promise<WorkflowPublic> {
    const wf = this.registry.findWorkflow(wfId);
    if (!wf) throw new Error(`no workflow "${wfId}"`);
    if (wf.state !== "failed") throw new Error(`workflow is ${wf.state}, not failed`);
    const team = this.teamOf(wf);
    const from = (wf.resumeFrom as Workflow["state"] | null) ?? "development";
    this.registry.updateWorkflow(wf.id, (w) => {
      w.resumeFrom = null;
    });
    this.log(wf, "system", `resuming from ${from}`);

    // unblock tasks that died mid-flight (e.g. session limits)
    for (const task of this.registry.teamTasks(team.id)) {
      if (task.status === "blocked" || task.status === "in_progress") {
        this.registry.updateTask(task.id, (t) => {
          t.status = "todo";
          t.notes.push("reset by resume");
        });
      }
    }

    const go = (state: Workflow["state"], run: () => Promise<void>) => {
      this.setState(wf, state, wf.gateQuestion);
      void run().catch((err) => this.fail(wf.id, err));
    };

    switch (from) {
      case "questions":
        go("questions", () => this.phaseQuestions(wf.id));
        break;
      case "awaiting_requirements":
        this.setState(wf, "awaiting_requirements", wf.gateQuestion);
        this.ceoSay(`Picking the ${team.name} venture back up — the team is still waiting on your answers:\n\n${wf.gateQuestion ?? ""}`);
        break;
      case "requirements":
      case "awaiting_req_approval":
        if (wf.requirements) {
          this.setState(wf, "awaiting_req_approval", wf.requirements);
          this.ceoSay(`Resuming ${team.name}: the requirements are ready for your review:\n\n${wf.requirements}\n\nReply "approved" or tell me what to change.`);
        } else {
          go("requirements", () => this.phaseRequirements(wf.id, "Use the previous investor answers in this conversation."));
        }
        break;
      case "architecture":
      case "awaiting_arch_approval":
        if (wf.architecture) {
          this.setState(wf, "awaiting_arch_approval", wf.architecture);
          this.ceoSay(`Resuming ${team.name}: the architecture is ready for your sign-off:\n\n${wf.architecture}\n\nSay "start development" or give feedback.`);
        } else {
          go("architecture", () => this.phaseArchitecture(wf.id, null));
        }
        break;
      case "planning":
        go("planning", () => this.phaseDevelopment(wf.id));
        break;
      case "development": {
        const open = this.registry
          .teamTasks(team.id)
          .some((t) => t.status === "todo" || t.status === "changes_requested" || t.status === "review");
        if (open) {
          go("development", async () => {
            await this.teams.runAll(team.id);
            await this.phaseTesting(wf.id);
          });
        } else {
          go("planning", () => this.phaseDevelopment(wf.id));
        }
        break;
      }
      case "testing": {
        // finish any open build tasks first, then re-test
        const openTasks = this.registry
          .teamTasks(team.id)
          .some((t) => t.status === "todo" || t.status === "changes_requested" || t.status === "review");
        go(openTasks ? "development" : "testing", async () => {
          if (openTasks) await this.teams.runAll(team.id);
          await this.phaseTesting(wf.id);
        });
        break;
      }
      case "security":
      case "fixing":
        go("security", () => this.phaseSecurity(wf.id, 1));
        break;
      case "delivery":
        go("delivery", () => this.phaseDelivery(wf.id));
        break;
      default:
        go("planning", () => this.phaseDevelopment(wf.id));
    }
    return this.toPublic(this.registry.findWorkflow(wf.id)!);
  }

  private async phaseQuestions(wfId: string): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    const pm = this.member(team, "pm")!;
    this.agents.emitAgentMessage("main", `${pm.name}@${team.id}`, "question", `new venture: ${wf.prompt}`);

    const questions = await this.ask(
      team,
      pm,
      [
        `You are the PM. The investor wants: "${wf.prompt}".`,
        `Skim this repository briefly to see what already exists.`,
        `Write the 4-7 most important clarifying questions you need answered before`,
        `writing requirements (scope, users, features, constraints, priorities).`,
        `Reply with ONLY a numbered list of questions.`,
      ].join("\n"),
      { maxTurns: 12 }
    );

    this.log(wf, `${pm.name}@${team.id}`, questions);
    this.setState(wf, "awaiting_requirements", questions);
    this.ceoSay(
      `I spoke with ${team.name}'s PM about "${wf.prompt}". Before we commit, they need your answers:\n\n${questions}\n\nReply here with your answers.`
    );
  }

  /** Route the investor's chat message into the open gate. Returns CEO's ack. */
  async answerGate(message: string): Promise<string> {
    const wf = this.activeGate();
    if (!wf) throw new Error("no gate open");
    this.log(wf, "investor", message);

    switch (wf.state) {
      case "awaiting_requirements":
        this.setState(wf, "requirements");
        void this.phaseRequirements(wf.id, message).catch((err) => this.fail(wf.id, err));
        return "Thanks — I've passed your answers to the PM. They're drafting the requirements now; I'll bring the document back to you shortly.";
      case "awaiting_req_approval":
        if (APPROVAL.test(message.trim())) {
          this.setState(wf, "architecture");
          void this.phaseArchitecture(wf.id, null).catch((err) => this.fail(wf.id, err));
          return "Requirements approved. The architect is designing the solution — I'll present the architecture for your sign-off next.";
        }
        this.setState(wf, "requirements");
        void this.phaseRequirements(wf.id, `The investor has feedback on the requirements draft — revise it accordingly:\n${message}`).catch((err) => this.fail(wf.id, err));
        return "Understood — sending your feedback back to the PM for a revision.";
      case "awaiting_arch_approval":
        if (APPROVAL.test(message.trim())) {
          this.setState(wf, "planning");
          void this.phaseDevelopment(wf.id).catch((err) => this.fail(wf.id, err));
          return "Green light received — development is starting. The PM is assigning tasks to the developers now. I'll report back when the build, review, testing and security passes are complete.";
        }
        this.setState(wf, "architecture");
        void this.phaseArchitecture(wf.id, message).catch((err) => this.fail(wf.id, err));
        return "Got it — the architect will rework the design with your feedback.";
      default:
        throw new Error(`gate in unexpected state ${wf.state}`);
    }
  }

  private async phaseRequirements(wfId: string, investorInput: string): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    const pm = this.member(team, "pm")!;

    const doc = await this.ask(
      team,
      pm,
      [
        `Venture: "${wf.prompt}".`,
        wf.requirements ? `Current requirements draft:\n${wf.requirements}` : ``,
        `Investor input:\n${investorInput}`,
        ``,
        `Produce the final REQUIREMENTS document: scope, core features (prioritized),`,
        `out-of-scope list, constraints. Max 350 words, markdown, no preamble.`,
      ].join("\n"),
      { maxTurns: 8 }
    );

    this.registry.updateWorkflow(wf.id, (w) => {
      w.requirements = doc;
    });
    this.log(wf, `${pm.name}@${team.id}`, `requirements drafted`);
    this.setState(wf, "awaiting_req_approval", doc);
    this.ceoSay(
      `${team.name}'s PM has the requirements ready:\n\n${doc}\n\nReply "approved" to move to architecture, or tell me what to change.`
    );
  }

  private async phaseArchitecture(wfId: string, feedback: string | null): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    const architect = this.member(team, "architect") ?? this.member(team, "developer")!;
    const pm = this.member(team, "pm")!;
    this.agents.emitAgentMessage(`${pm.name}@${team.id}`, `${architect.name}@${team.id}`, "question", "design the architecture");

    const arch = await this.ask(
      team,
      architect,
      [
        `You are the architect. Venture: "${wf.prompt}".`,
        `REQUIREMENTS:\n${wf.requirements}`,
        feedback ? `Investor feedback on the previous design:\n${feedback}\nPrevious design:\n${wf.architecture}` : ``,
        ``,
        `Design the architecture grounded in this repository's existing stack.`,
        `Write/overwrite ARCHITECTURE.md in the project root with the full design`,
        `(components, data model, key files to create/modify, tech choices + why).`,
        `Then reply with a summary of the design in under 250 words, no preamble.`,
      ].join("\n"),
      { write: true, maxTurns: 30 }
    );

    this.registry.updateWorkflow(wf.id, (w) => {
      w.architecture = arch;
    });
    this.log(wf, `${architect.name}@${team.id}`, `architecture drafted (ARCHITECTURE.md)`);
    this.agents.emitAgentMessage(`${architect.name}@${team.id}`, `${pm.name}@${team.id}`, "answer", "architecture ready");
    this.setState(wf, "awaiting_arch_approval", arch);
    this.ceoSay(
      `The architecture is ready (full version in ARCHITECTURE.md):\n\n${arch}\n\nSay "start development" to build it, or give me your feedback.`
    );
  }

  private async phaseDevelopment(wfId: string): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);

    // PM plans the board from requirements + architecture
    this.setState(wf, "planning");
    const plan = await this.teams.plan(
      team.id,
      [
        wf.prompt,
        `\n\nAPPROVED REQUIREMENTS:\n${wf.requirements}`,
        `\n\nAPPROVED ARCHITECTURE (see ARCHITECTURE.md):\n${wf.architecture}`,
        `\n\nCreate implementation tasks that realize this architecture. Spread work across all developers.`,
      ].join("")
    );
    this.log(wf, "pm", `plan: ${plan.summary}`);

    this.setState(wf, "development");
    await this.teams.runAll(team.id); // devs build; reviewer checks each task
    const blocked = this.registry.teamTasks(team.id).filter((t) => t.status === "blocked");
    this.log(wf, "system", blocked.length ? `development finished with ${blocked.length} blocked task(s)` : "development complete, all tasks through review");

    await this.phaseTesting(wfId);
  }

  private async phaseTesting(wfId: string): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    const tester = this.member(team, "tester");
    if (tester) {
      this.setState(wf, "testing");
      const report = await this.ask(
        team,
        tester,
        [
          `You are the QA engineer. Venture: "${wf.prompt}".`,
          `REQUIREMENTS:\n${wf.requirements}`,
          ``,
          `Verify the implementation end-to-end BY READING THE CODE: trace each core`,
          `requirement through the actual files. You cannot execute code, so reason`,
          `through the flows carefully. Report: what passes, what fails/missing`,
          `(with file:line), edge cases at risk. Under 250 words.`,
        ].join("\n"),
        { maxTurns: 30 }
      );
      this.log(wf, `${tester.name}@${team.id}`, report);
    }
    await this.phaseSecurity(wfId, 1);
  }

  private async phaseSecurity(wfId: string, round: number): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    const security = this.member(team, "security");
    if (!security) return this.phaseDelivery(wfId);

    this.setState(wf, "security");
    const audit = await this.ask(
      team,
      security,
      [
        `You are the security engineer. Audit this codebase for vulnerabilities:`,
        `injection, XSS, auth/session flaws, secrets in code, path traversal, unsafe deps, CSRF.`,
        `Focus on code written for: "${wf.prompt}".`,
        `If you find real issues, list each as "FINDING: <title> — <file> — <one-line fix>".`,
        `If the code is clean, reply exactly "NO FINDINGS". Under 250 words total.`,
      ].join("\n"),
      { maxTurns: 30 }
    );
    this.log(wf, `${security.name}@${team.id}`, audit);

    const findings = audit.split("\n").filter((l) => l.trim().startsWith("FINDING:"));
    if (findings.length > 0 && round === 1) {
      this.setState(wf, "fixing");
      const devs = team.members.filter((m) => m.role === "developer" || m.role === "devops");
      findings.slice(0, 6).forEach((finding, i) => {
        const task = this.registry.addTask({
          teamId: team.id,
          title: `security fix: ${finding.replace("FINDING:", "").trim().slice(0, 120)}`,
          description: `${finding}\n\nFix this vulnerability found by the security audit. Keep the fix minimal and targeted.`,
          assignee: devs[i % devs.length]!.name,
          etaMinutes: 20,
        });
        bus.emit({ type: "task.updated", task: { ...task } });
      });
      this.log(wf, "system", `${findings.length} security finding(s) → fix tasks created`);
      await this.teams.runAll(team.id);
      return this.phaseSecurity(wfId, 2);
    }
    if (findings.length > 0) {
      this.log(wf, "system", `${findings.length} finding(s) remain after fix round — flagged in delivery`);
    }
    await this.phaseDelivery(wfId);
  }

  private async phaseDelivery(wfId: string): Promise<void> {
    const wf = this.registry.findWorkflow(wfId)!;
    const team = this.teamOf(wf);
    this.setState(wf, "delivery");

    const tasks = this.registry.teamTasks(team.id);
    const done = tasks.filter((t) => t.status === "done").length;
    const recentLog = wf.log.slice(-8).map((l) => `${l.who}: ${l.text.slice(0, 300)}`).join("\n");

    // the CEO (main agent) writes the investor report itself
    const report = await this.agents.runForAgent(
      "main",
      [
        `You are Colony's CEO. Your team "${team.name}" just finished a venture for the investor.`,
        `Venture: "${wf.prompt}". Tasks completed: ${done}/${tasks.length}.`,
        `Recent pipeline log:\n${recentLog}`,
        ``,
        `Look at the project folder briefly, then write the investor delivery report:`,
        `what was built, where the key files are, test/security outcomes, honest`,
        `limitations, and suggested next steps. Under 300 words, warm but factual.`,
      ].join("\n"),
      {
        cwd: team.path,
        tools: READ_TOOLS as never,
        allowedTools: READ_TOOLS,
        maxTurns: 15,
        settingSources: [],
        permissionMode: "default",
      },
      420_000,
      (outcome) => {
        this.registry.addUsage(this.registry.mainAgent.usage, outcome.usage);
        bus.emit({ type: "agent.usage", agent: "main", delta: outcome.usage, total: this.registry.mainAgent.usage });
      }
    );

    this.log(wf, "ceo", report);
    this.setState(wf, "done");
    this.ceoSay(report);
  }
}
