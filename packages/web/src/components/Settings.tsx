import { useEffect, useState } from "react";
import { api } from "./../api";

const MODEL_OPTIONS = [
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (cheapest)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
];

export default function Settings() {
  const open = true;
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [folderModel, setFolderModel] = useState("claude-haiku-4-5");
  const [mainModel, setMainModel] = useState("claude-sonnet-4-6");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .getConfig()
      .then((cfg) => {
        setWorkspaceRoot(cfg.workspaceRoot ?? "");
        if (cfg.defaults) {
          setFolderModel(cfg.defaults.folderModel);
          setMainModel(cfg.defaults.mainModel);
        }
      })
      .catch(() => {});
  }, [open]);

  return (
    <section className="panel">
      <h2>Settings</h2>
      {open && (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.patchConfig({
                workspaceRoot: workspaceRoot.trim() || undefined,
                folderModel,
                mainModel,
              });
              setErr(null);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            } catch (error) {
              setErr(error instanceof Error ? error.message : "failed");
            }
          }}
        >
          <label>
            Workspace root
            <input value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} />
          </label>
          <label>
            Project experts model
            <select value={folderModel} onChange={(e) => setFolderModel(e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Main agent model
            <select value={mainModel} onChange={(e) => setMainModel(e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">{saved ? "Saved ✓" : "Save"}</button>
          {err && <p className="error">{err}</p>}
        </form>
      )}
    </section>
  );
}
