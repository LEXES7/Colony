import { useEffect, useState } from "react";
import { api } from "./api";
import { useHub } from "./store";
import { connectWs } from "./ws";
import ActivityFeed from "./components/ActivityFeed";
import ChatPane from "./components/ChatPane";
import DeptCard from "./components/DeptCard";
import Office from "./components/Office";
import Office3D from "./components/Office3D";
import ProjectList from "./components/ProjectList";
import Settings from "./components/Settings";
import TeamsPanel from "./components/TeamsPanel";
import UsagePanel from "./components/UsagePanel";

/**
 * Token bootstrap: the server prints a URL like http://…/#token=abc on
 * startup. We read it from the hash once, keep it in sessionStorage, and
 * immediately strip it from the address bar.
 */
function bootstrapToken(): string | null {
  const match = location.hash.match(/token=([a-f0-9]{32,})/);
  if (match) {
    sessionStorage.setItem("colony-token", match[1]!);
    history.replaceState(null, "", location.pathname);
    return match[1]!;
  }
  return sessionStorage.getItem("colony-token");
}

type Tab = "projects" | "teams" | "activity" | "usage" | "settings";

export default function App() {
  const { token, setToken, setupComplete, setConfig, setProjects, setTeams, connected } = useHub();
  const [tokenInput, setTokenInput] = useState("");
  const [rootInput, setRootInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("projects");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"3d" | "2d">(
    (localStorage.getItem("colony-view") as "3d" | "2d") || "3d"
  );

  useEffect(() => {
    setToken(bootstrapToken());
  }, [setToken]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg.setupComplete, cfg.workspaceRoot);
        setProjects(await api.listProjects());
        const teamData = await api.listTeams();
        setTeams(teamData.teams, teamData.tasks);
        connectWs();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to reach the server");
        if (e instanceof Error && /token/i.test(e.message)) {
          sessionStorage.removeItem("colony-token");
          setToken(null);
        }
      }
    })();
  }, [token, setConfig, setProjects, setTeams, setToken]);

  if (!token) {
    return (
      <div className="gate">
        <h1>Colony</h1>
        <p>Paste the access token printed in the server terminal, or open the full URL it printed.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem("colony-token", tokenInput.trim());
            setToken(tokenInput.trim());
          }}
        >
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="access token"
            autoFocus
          />
          <button type="submit" disabled={tokenInput.trim().length < 32}>
            Unlock
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (setupComplete === false) {
    return (
      <div className="gate">
        <h1>Colony — first run</h1>
        <p>
          Set your <strong>workspace root</strong>: the folder that contains your projects.
          Only folders inside it can be registered.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.setWorkspaceRoot(rootInput.trim());
              const cfg = await api.getConfig();
              setConfig(cfg.setupComplete, cfg.workspaceRoot);
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "failed");
            }
          }}
        >
          <input
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="/Users/you/Documents/GitHub"
            autoFocus
          />
          <button type="submit" disabled={rootInput.trim().length === 0}>
            Save
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="layout">
      <header>
        <h1>Colony</h1>
        <span className={connected ? "dot on" : "dot off"} title={connected ? "live" : "disconnected"} />
        <span className="tagline">the office</span>
        <button
          className="view-toggle"
          onClick={() => {
            const next = view === "3d" ? "2d" : "3d";
            setView(next);
            localStorage.setItem("colony-view", next);
          }}
        >
          {view === "3d" ? "2D view" : "3D view"}
        </button>
      </header>
      {error && <p className="error banner">{error}</p>}
      <div className="columns office-columns">
        <aside className="chat-side">
          <ChatPane />
        </aside>
        <main className="office-main">
          {view === "3d" ? (
            <Office3D selected={selected} onSelect={setSelected} />
          ) : (
            <Office selected={selected} onSelect={setSelected} />
          )}
          {selected && <DeptCard name={selected} onClose={() => setSelected(null)} />}
        </main>
        <aside className="tabs-side">
          <nav className="tabs">
            {(["projects", "teams", "activity", "usage", "settings"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          {tab === "projects" && <ProjectList />}
          {tab === "teams" && <TeamsPanel />}
          {tab === "activity" && <ActivityFeed />}
          {tab === "usage" && <UsagePanel />}
          {tab === "settings" && <Settings />}
        </aside>
      </div>
    </div>
  );
}
