const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { execFile } = require("child_process");

// --- Writable cache/userData (fix cache errors) ---
const safeUserData = path.join(app.getPath("appData"), "VyltrexLauncher");
app.setPath("userData", safeUserData);
app.setPath("cache", path.join(safeUserData, "Cache"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disk-cache-dir", path.join(safeUserData, "Cache"));

// --- Install location in AppData ---
const INSTALL_ROOT = path.join(safeUserData, "Games");
const META_DIR = path.join(safeUserData, "Meta");
const INSTALLED_FILE = path.join(META_DIR, "installed.json");
const GAMES_FILE = path.join(__dirname, "games.json");

function ensureDirs() {
  if (!fs.existsSync(INSTALL_ROOT)) fs.mkdirSync(INSTALL_ROOT, { recursive: true });
  if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
  if (!fs.existsSync(INSTALLED_FILE)) fs.writeFileSync(INSTALLED_FILE, "{}");
}

function readInstalled() {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(INSTALLED_FILE, "utf8")); }
  catch { return {}; }
}
function writeInstalled(obj) {
  ensureDirs();
  fs.writeFileSync(INSTALLED_FILE, JSON.stringify(obj, null, 2));
}
function readGames() {
  return JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadToFile(url, outPath, onProgress) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 0,
    maxRedirects: 10,
    headers: { "User-Agent": "VyltrexLauncher/1.0" }
  });

  const total = Number(res.headers["content-length"] || 0);
  let done = 0;

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    res.data.on("data", (chunk) => {
      done += chunk.length;
      if (total > 0 && onProgress) onProgress((done / total) * 100);
    });
    res.data.on("error", reject);
    w.on("finish", resolve);
    w.on("error", reject);
    res.data.pipe(w);
  });
}

function listTopLevelFolders(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return []; }
}

function findExeRecursive(dir, exeName) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase() === exeName.toLowerCase()) return p;
    }
  }
  return null;
}

// Extract with progress (entry-by-entry)
function extractZipWithProgress(zipPath, outDir, progressCb) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const total = Math.max(entries.length, 1);
  let i = 0;

  for (const entry of entries) {
    // Extract current entry
    zip.extractEntryTo(entry, outDir, /*maintainEntryPath*/ true, /*overwrite*/ true);
    i++;
    const p = (i / total) * 100;
    if (progressCb) progressCb(p);
  }
}

async function installGame(game, progressCb) {
  ensureDirs();
  const tmpZip = path.join(META_DIR, `${game.id}.zip`);
  const gameDir = path.join(INSTALL_ROOT, game.id);

  if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true, force: true });
  fs.mkdirSync(gameDir, { recursive: true });

  progressCb?.(0, "Downloading");
  await downloadToFile(game.download, tmpZip, (p) => progressCb?.(p, "Downloading"));

  progressCb?.(0, "Verifying");
  if (game.sha256 && String(game.sha256).trim().length > 0) {
    const got = await sha256File(tmpZip);
    if (got.toLowerCase() !== String(game.sha256).toLowerCase()) {
      fs.rmSync(tmpZip, { force: true });
      throw new Error("SHA256 mismatch. Download corrupted or file changed.");
    }
  }

  progressCb?.(0, "Extracting");
  extractZipWithProgress(tmpZip, gameDir, (p) => progressCb?.(p, "Extracting"));
  fs.rmSync(tmpZip, { force: true });

  // Find exe anywhere (ZIP may contain a top folder)
  let exePath = path.join(gameDir, game.exe);
  let baseDir = gameDir;

  if (!fs.existsSync(exePath)) {
    const found = findExeRecursive(gameDir, game.exe);
    if (found) {
      exePath = found;
      baseDir = path.dirname(found);
    } else {
      const tops = listTopLevelFolders(gameDir);
      throw new Error(
        `EXE not found: ${game.exe}. ` +
        (tops.length ? `Top folder(s) in ZIP: ${tops.join(", ")}` : "ZIP may be empty or different.")
      );
    }
  }

  const installed = readInstalled();
  installed[game.id] = {
    gameDir,
    baseDir,
    exe: path.basename(exePath),
    installedAt: new Date().toISOString()
  };
  writeInstalled(installed);

  progressCb?.(100, "Done");
  return true;
}

async function uninstallGame(gameId) {
  ensureDirs();
  const installed = readInstalled();
  const gameDir = installed[gameId]?.gameDir || path.join(INSTALL_ROOT, gameId);
  if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true, force: true });
  delete installed[gameId];
  writeInstalled(installed);
  return true;
}

async function launchGame(gameId, exeNameFromUI) {
  ensureDirs();
  const installed = readInstalled();
  const baseDir = installed[gameId]?.baseDir;
  if (!baseDir) throw new Error("Game not installed.");

  // Always prefer installed.json exe (because it’s the real found exe)
  const exe = installed[gameId]?.exe || exeNameFromUI;
  const exePath = path.join(baseDir, exe);

  if (!fs.existsSync(exePath)) {
    throw new Error(`EXE not found: ${exe}. (Installed base: ${baseDir})`);
  }
  execFile(exePath, { cwd: baseDir });
  return true;
}

let win;
app.whenReady().then(() => {
  ensureDirs();
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile("index.html");
});

ipcMain.handle("get-games", async () => {
  const games = readGames();
  const installed = readInstalled();
  return games.map(g => ({ ...g, installed: !!installed[g.id] }));
});

ipcMain.handle("install", async (evt, gameId) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  if (!game) throw new Error("Game not found in games.json");

  const send = (p, stage) => win?.webContents.send("install-progress", {
    gameId,
    percent: Math.max(0, Math.min(100, Math.round(p))),
    stage
  });

  try {
    await installGame(game, send);
    win?.webContents.send("install-done", { gameId });
    return true;
  } catch (e) {
    win?.webContents.send("install-error", { gameId, message: String(e?.message || e) });
    throw e;
  }
});

ipcMain.handle("uninstall", async (evt, gameId) => {
  await uninstallGame(gameId);
  win?.webContents.send("uninstall-done", { gameId });
  return true;
});

ipcMain.handle("launch", async (evt, gameId, exeName) => {
  return await launchGame(gameId, exeName);
});

ipcMain.handle("open-external", async (evt, url) => {
  await shell.openExternal(url);
  return true;
});
