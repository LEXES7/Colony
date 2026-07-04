/**
 * Colony desktop shell: boots the Colony server as a child process, waits for
 * it to come up, reads the local auth token, and opens the dashboard in a
 * native window. Closing the window shuts the server down.
 */
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const serverDir = path.join(rootDir, "packages", "server");
const tokenPath = path.join(rootDir, "data", ".hub-token");
const PORT = 4173;

let serverProc = null;

function startServer() {
  // reuse an already-running Colony if there is one
  serverProc = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    stdio: "ignore",
    detached: false,
  });
  serverProc.on("error", () => {});
}

function waitForServer(tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 900 }, (res) => {
        res.resume();
        // 401/403 also mean the server is alive (auth guard)
        resolve(undefined);
      });
      req.on("error", () => (left > 0 ? setTimeout(() => attempt(left - 1), 500) : reject(new Error("server did not start"))));
      req.on("timeout", () => {
        req.destroy();
        left > 0 ? setTimeout(() => attempt(left - 1), 500) : reject(new Error("server did not start"));
      });
    };
    attempt(tries);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: "Colony",
    backgroundColor: "#0f1115",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // external links open in the real browser, never inside the shell
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) shell.openExternal(url);
    return { action: "deny" };
  });

  const token = fs.readFileSync(tokenPath, "utf8").trim();
  await win.loadURL(`http://127.0.0.1:${PORT}/#token=${token}`);
}

app.whenReady().then(async () => {
  try {
    await waitForServer(2); // already running?
  } catch {
    startServer();
    await waitForServer();
  }
  // token file appears on first server boot
  for (let i = 0; i < 40 && !fs.existsSync(tokenPath); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  if (serverProc) serverProc.kill();
  app.quit();
});
