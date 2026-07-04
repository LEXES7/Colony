import { useHub } from "./../store";
import { api } from "./../api";

const MODEL_CHOICES = [
  { value: "", label: "default model" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
];

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Floating card shown when a room in the office is clicked. */
export default function DeptCard({ name, onClose }: { name: string; onClose: () => void }) {
  const { projects, setProjects, mainUsage, teams, tasks } = useHub();

  const refresh = async () => setProjects(await api.listProjects());

  const team = teams.find((t) => t.id === name);
  if (team) {
    const board = tasks.filter((t) => t.teamId === team.id);
    const done = board.filter((t) => t.status === "done").length;
    return (
      <div className="dept-card">
        <div className="dept-head">
          <h3>⚑ {team.name}</h3>
          <button className="linklike" onClick={onClose}>✕</button>
        </div>
        <p className="path">{team.path}</p>
        {team.goal && <p className="summary">🎯 {team.goal}</p>}
        <div className="member-chips">
          {team.members.map((m) => (
            <span key={m.name} className={`chip ${m.status}`} title={m.role}>
              {m.name} · {m.role}
            </span>
          ))}
        </div>
        <p className="mini-usage">
          {done}/{board.length} tasks done — manage the board in the Teams tab.
        </p>
      </div>
    );
  }

  if (name === "main") {
    return (
      <div className="dept-card">
        <div className="dept-head">
          <h3>Main agent</h3>
          <button className="linklike" onClick={onClose}>✕</button>
        </div>
        <p className="summary">
          The coordinator. Chat with it on the left — it consults your department experts when a
          question touches their projects.
        </p>
        {mainUsage && (
          <p className="mini-usage">
            {fmt(mainUsage.inputTokens)} in · {fmt(mainUsage.outputTokens)} out ·{" "}
            {fmt(mainUsage.cacheReadTokens)} cached · ~${mainUsage.estCostUsd.toFixed(3)}
          </p>
        )}
      </div>
    );
  }

  const p = projects.find((x) => x.name === name);
  if (!p) return null;

  return (
    <div className="dept-card">
      <div className="dept-head">
        <h3>{p.name}</h3>
        <button className="linklike" onClick={onClose}>✕</button>
      </div>
      <p className="path">{p.path}</p>
      <div className="dept-controls">
        <label className="switch">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={() => api.patchProject(p.name, { enabled: !p.enabled }).then(refresh).catch(() => {})}
          />
          <span className="slider" />
        </label>
        <span className={`status ${p.status}`}>{p.status}</span>
        <select
          value={p.model ?? ""}
          onChange={(e) =>
            api.patchProject(p.name, { model: e.target.value || null }).then(refresh).catch(() => {})
          }
        >
          {MODEL_CHOICES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <p className="summary">
        {p.summary ?? (p.enabled ? "generating summary…" : "enable to generate a summary")}
      </p>
      {p.usage.queries > 0 && (
        <p className="mini-usage">
          {fmt(p.usage.inputTokens)} in · {fmt(p.usage.outputTokens)} out ·{" "}
          {fmt(p.usage.cacheReadTokens)} cached · ~${p.usage.estCostUsd.toFixed(3)}
        </p>
      )}
      <div className="actions">
        <button onClick={() => api.summarize(p.name).then(refresh).catch(() => {})}>
          Regenerate summary
        </button>
        <button onClick={() => api.patchProject(p.name, { resetSession: true }).catch(() => {})}>
          Reset session
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Remove ${p.name} from Colony? (the folder is not touched)`)) {
              api.deleteProject(p.name).then(refresh).then(onClose).catch(() => {});
            }
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
