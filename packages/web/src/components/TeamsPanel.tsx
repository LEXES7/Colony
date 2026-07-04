import { useEffect, useState } from "react";
import type { TaskPublic, TeamPublic, TeamRole } from "@colony/shared";
import { api } from "./../api";
import { useHub } from "./../store";

const ROLE_PRESETS: { name: string; role: TeamRole; label: string }[] = [
  { name: "pm", role: "pm", label: "Project manager" },
  { name: "dev-1", role: "developer", label: "Developer 1" },
  { name: "dev-2", role: "developer", label: "Developer 2" },
  { name: "reviewer", role: "reviewer", label: "PR reviewer" },
  { name: "devops", role: "devops", label: "DevOps" },
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
  const { teams, tasks, setTeams } = useHub();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["pm", "dev-1", "reviewer"]));
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="team name" />
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/absolute/path/to/project" />
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
              {boardTasks.length === 0 && <li className="empty">No tasks yet — set a goal and hit Plan.</li>}
            </ul>
          </div>
        );
      })}
      {teams.length === 0 && <p className="empty">No teams yet. Create one above — pick a PM plus at least one developer.</p>}
    </section>
  );
}
