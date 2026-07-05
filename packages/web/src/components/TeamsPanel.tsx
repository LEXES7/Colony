import { useEffect, useState } from "react";
import type { TaskPublic, TeamPublic, TeamRole } from "@colony/shared";
import { api } from "./../api";
import { useHub } from "./../store";

const ROLE_PRESETS: { name: string; role: TeamRole; label: string }[] = [
  { name: "pm", role: "pm", label: "Project manager" },
  { name: "architect", role: "architect", label: "Architect" },
  { name: "dev-1", role: "developer", label: "Developer 1" },
  { name: "dev-2", role: "developer", label: "Developer 2" },
  { name: "reviewer", role: "reviewer", label: "PR reviewer" },
  { name: "tester", role: "tester", label: "QA tester" },
  { name: "security", role: "security", label: "Security" },
  { name: "devops", role: "devops", label: "DevOps" },
];

const WF_STEPS: { key: string; label: string }[] = [
  { key: "questions", label: "PM questions" },
  { key: "awaiting_requirements", label: "your answers" },
  { key: "requirements", label: "requirements" },
  { key: "awaiting_req_approval", label: "your approval" },
  { key: "architecture", label: "architecture" },
  { key: "awaiting_arch_approval", label: "green light" },
  { key: "planning", label: "planning" },
  { key: "development", label: "development" },
  { key: "testing", label: "testing" },
  { key: "security", label: "security" },
  { key: "fixing", label: "fixes" },
  { key: "delivery", label: "delivery" },
  { key: "done", label: "done" },
];

function etaBadge(task: TaskPublic, now: number): { text: string; overdue: boolean } {
  if (task.etaMinutes == null) return { text: "no ETA", overdue: false };
  if (task.status === "in_progress" && task.startedAt) {
    const due = new Date(task.startedAt).getTime() + task.etaMinutes * 60_000;
    const left = Math.round((due - now) / 60_000);
    return left >= 0
      ? { text: `${left}m left`, overdue: false }
      : { text: `overdue ${-left}m`, overdue: true };
  }
  if (task.status === "done" && task.startedAt && task.finishedAt) {
    const took = Math.max(1, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 60_000));
    return { text: `took ${took}m / eta ${task.etaMinutes}m`, overdue: took > task.etaMinutes };
  }
  return { text: `eta ${task.etaMinutes}m`, overdue: false };
}

export default function TeamsPanel() {
  const { teams, tasks, workflows, setTeams } = useHub();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    new Set(["pm", "architect", "dev-1", "dev-2", "reviewer", "tester", "security"])
  );
  const [ventures, setVentures] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busyBtn, setBusyBtn] = useState<string | null>(null);
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [openTask, setOpenTask] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusyBtn(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusyBtn(null);
    }
  };

  return (
    <section className="panel teams">
      <h2>Teams</h2>
      <form
        className="add-form"
        onSubmit={(e) => {
          e.preventDefault();
          const members = ROLE_PRESETS.filter((r) => picked.has(r.name)).map((r) => ({
            name: r.name,
            role: r.role,
          }));
          void act("create", async () => {
            await api.createTeam({ name: name.trim(), path: path.trim(), members });
            const data = await api.listTeams();
            setTeams(data.teams, data.tasks);
            setName("");
            setPath("");
          });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="team name — e.g. web team" />
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="project folder — drag it here from Finder, or paste the path" />
        <div className="role-picks">
          {ROLE_PRESETS.map((r) => (
            <label key={r.name} className={picked.has(r.name) ? "pick on" : "pick"}>
              <input
                type="checkbox"
                checked={picked.has(r.name)}
                onChange={() => {
                  const next = new Set(picked);
                  next.has(r.name) ? next.delete(r.name) : next.add(r.name);
                  setPicked(next);
                }}
              />
              {r.label}
            </label>
          ))}
        </div>
        <button type="submit" disabled={!name.trim() || !path.trim() || picked.size === 0 || busyBtn === "create"}>
          Create team
        </button>
      </form>
      {err && <p className="error">{err}</p>}

      {teams.map((team) => {
        const boardTasks = tasks
          .filter((t) => t.teamId === team.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const doneCount = boardTasks.filter((t) => t.status === "done").length;
        const remainingEta = boardTasks
          .filter((t) => t.status !== "done" && t.etaMinutes != null)
          .reduce((sum, t) => sum + (t.etaMinutes ?? 0), 0);
        return (
          <div className="team-card" key={team.id}>
            <div className="team-head">
              <strong>{team.name}</strong>
              <span className="mini-usage">
                {doneCount}/{boardTasks.length} done{remainingEta > 0 ? ` · ~${remainingEta}m left` : ""}
              </span>
              <button
                className="danger tiny"
                onClick={() => {
                  if (confirm(`Delete team ${team.name} and its board?`)) {
                    void act(`del-${team.id}`, async () => {
                      await api.deleteTeam(team.id);
                      const data = await api.listTeams();
                      setTeams(data.teams, data.tasks);
                    });
                  }
                }}
              >
                ✕
              </button>
            </div>
            <p className="path">{team.path}</p>
            <div className="member-chips">
              {team.members.map((m) => (
                <span key={m.name} className={`chip ${m.status}`} title={`${m.role} — ${m.status}`}>
                  {m.name}
                </span>
              ))}
            </div>

            {/* company mode: investor → CEO → PM pipeline */}
            {(() => {
              const wf = workflows.filter((w) => w.teamId === team.id).slice(-1)[0];
              const stepIdx = wf ? WF_STEPS.findIndex((s) => s.key === wf.state) : -1;
              return (
                <div className="venture">
                  {!wf || wf.state === "done" || wf.state === "failed" ? (
                    <div className="goal-row">
                      <input
                        value={ventures[team.id] ?? ""}
                        onChange={(e) => setVentures({ ...ventures, [team.id]: e.target.value })}
                        placeholder='What should this team build? e.g. "an online store"'
                      />
                      <button
                        disabled={busyBtn === `wf-${team.id}` || (ventures[team.id] ?? "").trim().length < 10}
                        onClick={() =>
                          void act(`wf-${team.id}`, async () => {
                            await api.startWorkflow(team.id, ventures[team.id]!.trim());
                            setVentures({ ...ventures, [team.id]: "" });
                          })
                        }
                      >
                        Start venture
                      </button>
                    </div>
                  ) : null}
                  {wf && (
                    <div className={`wf ${wf.state}`}>
                      <div className="wf-steps">
                        {WF_STEPS.map((s, i) => (
                          <span
                            key={s.key}
                            className={
                              wf.state === "failed"
                                ? "wf-step failed"
                                : i < stepIdx
                                  ? "wf-step past"
                                  : i === stepIdx
                                    ? "wf-step now"
                                    : "wf-step"
                            }
                          >
                            {s.label}
                          </span>
                        ))}
                      </div>
                      {wf.state.startsWith("awaiting") && (
                        <p className="wf-gate">⏸ waiting for you — reply in the chat on the left</p>
                      )}
                      {wf.state === "failed" && (
                        <button
                          disabled={busyBtn === `res-${wf.id}`}
                          onClick={() => void act(`res-${wf.id}`, () => api.resumeWorkflow(wf.id))}
                        >
                          {busyBtn === `res-${wf.id}` ? "resuming…" : "▶ Resume where it stopped"}
                        </button>
                      )}
                      {wf.log.length > 0 && (
                        <p className="wf-last">
                          {wf.log[wf.log.length - 1]!.who}: {wf.log[wf.log.length - 1]!.text.slice(0, 160)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {team.goal ? (
              <p className="goal">🎯 {team.goal}</p>
            ) : null}
            <div className="goal-row">
              <input
                value={goals[team.id] ?? ""}
                onChange={(e) => setGoals({ ...goals, [team.id]: e.target.value })}
                placeholder={team.goal ? "new goal (replaces board)" : "describe the goal for this team"}
              />
              <button
                disabled={busyBtn === `plan-${team.id}` || (goals[team.id] ?? "").trim().length < 10}
                onClick={() =>
                  void act(`plan-${team.id}`, async () => {
                    await api.planTeam(team.id, goals[team.id]!.trim());
                    setGoals({ ...goals, [team.id]: "" });
                  })
                }
              >
                {busyBtn === `plan-${team.id}` ? "PM planning…" : "Plan"}
              </button>
              <button
                disabled={busyBtn === `all-${team.id}` || boardTasks.every((t) => t.status !== "todo" && t.status !== "changes_requested")}
                onClick={() => void act(`all-${team.id}`, () => api.runAll(team.id))}
                title="Run every open task in order"
              >
                Run all
              </button>
            </div>

            <ul className="board">
              {boardTasks.map((task) => {
                const eta = etaBadge(task, now);
                return (
                  <li key={task.id} className={`task ${task.status}`}>
                    <div className="task-row" onClick={() => setOpenTask(openTask === task.id ? null : task.id)}>
                      <span className={`tstatus ${task.status}`}>{task.status.replace("_", " ")}</span>
                      <span className="ttitle">{task.title}</span>
                      <span className="tassignee">@{task.assignee}</span>
                      <span className={eta.overdue ? "teta overdue" : "teta"}>{eta.text}</span>
                    </div>
                    {openTask === task.id && (
                      <div className="task-detail">
                        <p>{task.description}</p>
                        {task.notes.length > 0 && (
                          <ul className="tnotes">
                            {task.notes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        )}
                        {task.result && <p className="tresult">✅ {task.result}</p>}
                        {task.review && <p className="treview">🔎 {task.review}</p>}
                        <div className="actions">
                          {(task.status === "todo" || task.status === "changes_requested" || task.status === "blocked") && (
                            <button
                              disabled={busyBtn === `run-${task.id}`}
                              onClick={() => void act(`run-${task.id}`, () => api.runTask(task.id))}
                            >
                              {busyBtn === `run-${task.id}` ? "working…" : "Run"}
                            </button>
                          )}
                          {task.status === "review" && (
                            <button
                              disabled={busyBtn === `rev-${task.id}`}
                              onClick={() => void act(`rev-${task.id}`, () => api.reviewTask(task.id))}
                            >
                              {busyBtn === `rev-${task.id}` ? "reviewing…" : "Review"}
                            </button>
                          )}
                          <button onClick={() => void act(`done-${task.id}`, () => api.patchTask(task.id, { status: "done" }))}>
                            Mark done
                          </button>
                          <button
                            className="danger"
                            onClick={() => void act(`deltask-${task.id}`, () => api.deleteTask(task.id))}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
              {boardTasks.length === 0 && <li className="empty">Nothing on the board yet — tell the team what to build.</li>}
            </ul>
          </div>
        );
      })}
      {teams.length === 0 && <p className="empty">No teams yet. Give one a name, point it at a project folder, and pick who's on it — then just tell it what to build.</p>}
    </section>
  );
}
