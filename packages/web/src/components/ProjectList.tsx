import { useState } from "react";
import { api } from "./../api";
import { useHub } from "./../store";

export default function ProjectList() {
  const { projects, setProjects } = useHub();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => setProjects(await api.listProjects());

  return (
    <section className="panel">
      <h2>Projects</h2>
      <form
        className="add-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.addProject(name.trim(), path.trim());
            setName("");
            setPath("");
            setErr(null);
            await refresh();
          } catch (error) {
            setErr(error instanceof Error ? error.message : "failed");
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="short name — e.g. my-shop" />
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="project folder — paste its path" />
        <button type="submit" disabled={!name.trim() || !path.trim()}>
          Add
        </button>
      </form>
      {err && <p className="error">{err}</p>}

      <ul className="projects">
        {projects.map((p) => (
          <li key={p.name}>
            <div className="project-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={async () => {
                    try {
                      await api.patchProject(p.name, { enabled: !p.enabled });
                      setErr(null);
                      await refresh();
                    } catch (error) {
                      setErr(error instanceof Error ? error.message : "failed");
                    }
                  }}
                />
                <span className="slider" />
              </label>
              <button
                className="name"
                onClick={() => setExpanded(expanded === p.name ? null : p.name)}
                title={p.path}
              >
                {p.name}
              </button>
              <span className={`status ${p.status}`}>{p.status}</span>
            </div>
            {expanded === p.name && (
              <div className="project-detail">
                <p className="path">{p.path}</p>
                <p className="summary">
                  {p.summary ?? (p.enabled ? "generating summary…" : "enable to generate a summary")}
                </p>
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
                        api.deleteProject(p.name).then(refresh).catch(() => {});
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {projects.length === 0 && <li className="empty">No projects yet — add a folder and flip it on. Its agent will learn the codebase for you.</li>}
      </ul>
    </section>
  );
}
