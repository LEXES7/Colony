import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentManager } from "../agents/agentManager.js";
import type { TeamManager } from "../agents/teamManager.js";
import type { WorkflowManager } from "../agents/workflowManager.js";
import type { Registry } from "../registry.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * In-process MCP server exposed to the main agent. Handlers must return
 * isError instead of throwing — a thrown error kills the whole chat query.
 */
export function createHubServer(
  registry: Registry,
  manager: AgentManager,
  teams: TeamManager,
  workflows: WorkflowManager
) {
  return createSdkMcpServer({
    name: "hub",
    version: "1.0.0",
    tools: [
      tool(
        "ask_project_agent",
        "Ask another registered project's expert agent one specific question about its codebase. " +
          "Use this instead of exploring other projects yourself. The expert answers briefly with file citations.",
        {
          project: z.string().describe("Registered project name (see list_projects)"),
          question: z.string().min(3).max(2000).describe("One specific, answerable question"),
        },
        async ({ project, question }) => {
          manager.emitAgentMessage("main", project, "question", question);
          try {
            const answer = await manager.askProject(project, question);
            manager.emitAgentMessage(project, "main", "answer", answer);
            return text(answer);
          } catch (err) {
            manager.emitAgentMessage(project, "main", "error", msg(err));
            return fail(`Could not consult "${project}": ${msg(err)}`);
          }
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "list_projects",
        "List registered projects with their enabled state, so you know which experts are available.",
        {},
        async () => {
          const lines = registry.projects.map(
            (p) => `- ${p.name} (${p.enabled ? "enabled" : "disabled"}): ${p.summary?.slice(0, 120) ?? "no summary"}`
          );
          return text(lines.join("\n") || "No projects registered.");
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "list_teams",
        "List the user's teams: members, task board summary, and the state of their latest venture. " +
          "ALWAYS check this before answering anything about teams — never guess.",
        {},
        async () => {
          if (registry.teams.length === 0) return text("No teams exist yet. The user can create one in the Teams tab.");
          const lines = registry.teams.map((team) => {
            const tasks = registry.teamTasks(team.id);
            const done = tasks.filter((t) => t.status === "done").length;
            const wf = registry.workflows.filter((w) => w.teamId === team.id).slice(-1)[0];
            const members = team.members.map((m) => `${m.name}(${m.role})`).join(", ");
            return [
              `## ${team.name} (id: ${team.id})`,
              `folder: ${team.path}`,
              `members: ${members}`,
              `board: ${done}/${tasks.length} tasks done`,
              wf ? `latest venture: "${wf.prompt.slice(0, 80)}" — state: ${wf.state}${wf.state === "failed" ? ` (failed during ${wf.resumeFrom}; can be resumed)` : ""}` : `no venture yet`,
            ].join("\n");
          });
          return text(lines.join("\n\n"));
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "team_board",
        "Get a team's full task board: every task with status, assignee, ETA and latest notes.",
        { team: z.string().describe("Team id (see list_teams)") },
        async ({ team }) => {
          if (!registry.findTeam(team)) return fail(`no team "${team}"`);
          const tasks = registry.teamTasks(team);
          if (tasks.length === 0) return text("The board is empty.");
          return text(
            tasks
              .map(
                (t) =>
                  `- [${t.status}] ${t.title} — @${t.assignee}, eta ${t.etaMinutes ?? "?"}m${t.notes.length ? ` — last note: ${t.notes[t.notes.length - 1]}` : ""}`
              )
              .join("\n")
          );
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "start_venture",
        "Kick off the full company pipeline on a team for a new goal the user described. " +
          "The team's PM will come back with clarifying questions in the chat.",
        {
          team: z.string().describe("Team id (see list_teams)"),
          prompt: z.string().min(10).max(4000).describe("The user's goal, in their words"),
        },
        async ({ team, prompt }) => {
          try {
            const wf = await workflows.start(team, prompt);
            return text(`Venture ${wf.id} started. The team is preparing questions for the user — they will arrive in this chat shortly. Tell the user that.`);
          } catch (err) {
            return fail(msg(err));
          }
        }
      ),
      tool(
        "resume_venture",
        "Resume a team's failed venture exactly where it stopped (e.g. after a session limit). " +
          "Use when the user asks to continue/resume work.",
        { team: z.string().describe("Team id (see list_teams)") },
        async ({ team }) => {
          try {
            const wf = workflows.findResumable(team);
            if (!wf) return fail(`team "${team}" has no failed venture to resume`);
            const resumed = await workflows.resume(wf.id);
            return text(`Venture resumed from "${resumed.state}". Progress will appear in the activity feed and this chat. Tell the user it's back underway — do not paste any code or commands.`);
          } catch (err) {
            return fail(msg(err));
          }
        }
      ),
      tool(
        "run_open_tasks",
        "Run all open tasks on a team's board (build → review each). Fire-and-forget; progress streams to the dashboard.",
        { team: z.string().describe("Team id (see list_teams)") },
        async ({ team }) => {
          if (!registry.findTeam(team)) return fail(`no team "${team}"`);
          try {
            void teams.runAll(team);
            return text("The team is working through the open tasks now. Tell the user; progress shows live on the board.");
          } catch (err) {
            return fail(msg(err));
          }
        }
      ),
    ],
  });
}
