// ═══════════════════════════════════════════════════
// Claude GLM Desktop — Main Process
// ═══════════════════════════════════════════════════

// Sandbox flags MUST be set before requiring electron
const { app } = require("electron");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

const {
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
} = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const zlib = require("zlib");
const os = require("os");

// Suppress EPIPE crashes — child process pipes can break after exit
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE") return;
  console.error("[uncaught]", err);
});

// ── State ──────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let proxyProcess = null;
let proxyRunning = false;
let startTime = null;
let uptimeInterval = null;
let cachedClaudeVersion = null;

// ── Paths ──────────────────────────────────────────────
const PROXY_PATH = path.resolve(__dirname, "..", "proxy.js");
const CONFIG_DIR = path.join(os.homedir(), ".config", "claude-glm");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ── Config ─────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function getApiKey() {
  return process.env.ZAI_API_KEY || loadConfig().apiKey || "";
}

function setApiKey(key) {
  process.env.ZAI_API_KEY = key;
  const cfg = loadConfig();
  cfg.apiKey = key;
  saveConfig(cfg);
}

// ── Proxy Management ───────────────────────────────────
function checkProxyStatus() {
  return new Promise((resolve) => {
    const req = http.get("http://localhost:9147/", (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startProxy() {
  return new Promise((resolve, reject) => {
    if (proxyRunning) {
      resolve({ success: true, message: "Already running" });
      return;
    }

    if (!fs.existsSync(PROXY_PATH)) {
      reject(new Error(`proxy.js not found at ${PROXY_PATH}`));
      return;
    }

    proxyProcess = spawn("node", [PROXY_PATH], { env: process.env, stdio: "pipe" });

    let started = false;

    // Suppress EPIPE — proxy process may exit while we still have listeners attached
    proxyProcess.stdout.on("error", () => {});
    proxyProcess.stderr.on("error", () => {});

    proxyProcess.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("claude-glm-proxy is running") && !started) {
        started = true;
        proxyRunning = true;
        startTime = Date.now();
        startUptimeTracker();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
        }
        resolve({ success: true, message: "Proxy started" });
      }
    });

    proxyProcess.stderr.on("data", (data) => {
      console.error("[proxy stderr]", data.toString());
    });

    proxyProcess.on("close", (code) => {
      proxyProcess = null;
      proxyRunning = false;
      startTime = null;
      stopUptimeTracker();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
      }
      if (!started) {
        reject(new Error(`Proxy exited with code ${code}`));
      }
    });

    proxyProcess.on("error", (err) => {
      proxyProcess = null;
      proxyRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
      }
      reject(err);
    });

    // Fallback: check port after 2.5s in case stdout was missed
    setTimeout(() => {
      if (!started) {
        checkProxyStatus().then((running) => {
          if (running && !started) {
            started = true;
            proxyRunning = true;
            startTime = Date.now();
            startUptimeTracker();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
            }
            resolve({ success: true, message: "Proxy started (detected)" });
          }
        });
      }
    }, 2500);
  });
}

function stopProxy() {
  return new Promise((resolve) => {
    if (proxyProcess) {
      proxyProcess.kill("SIGTERM");
      setTimeout(() => {
        if (proxyProcess) proxyProcess.kill("SIGKILL");
        proxyProcess = null;
        proxyRunning = false;
        startTime = null;
        stopUptimeTracker();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
        }
        resolve({ success: true, message: "Proxy stopped" });
      }, 500);
    } else {
      try { execSync("fuser -k 9147/tcp 2>/dev/null || true", { stdio: "ignore" }); } catch {}
      proxyRunning = false;
      startTime = null;
      stopUptimeTracker();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("proxy-status-changed", proxyRunning, getUptime());
      }
      resolve({ success: true, message: "Proxy stopped" });
    }
  });
}

function getUptime() {
  if (!startTime) return null;
  const s = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function startUptimeTracker() {
  stopUptimeTracker();
  uptimeInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("uptime-update", getUptime());
    }
  }, 1000);
}

function stopUptimeTracker() {
  if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
}

// ── Claude Code Launch ─────────────────────────────────

// Resolve the real claude binary path.
// fnm creates session-temp symlinks under /run/user/.../fnm_multishells/ that
// won't exist in a freshly spawned terminal. We resolve to the stable fnm path.
let cachedClaudePath = null;

function getClaudeVersion() {
  if (cachedClaudeVersion) return cachedClaudeVersion;

  try {
    const claudeBin = resolveClaudePath();
    const output = execSync(`"${claudeBin}" --version`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    cachedClaudeVersion = output;
    return output;
  } catch (err) {
    cachedClaudeVersion = "not found";
    return "not found";
  }
}

function resolveClaudePath() {
  if (cachedClaudePath) return cachedClaudePath;

  // 1. Check stable fnm install path directly
  const home = os.homedir();
  try {
    const fnmDir = fs.readdirSync(path.join(home, ".local/share/fnm/node-versions"))
      .sort()
      .pop(); // latest installed version
    if (fnmDir) {
      const stable = path.join(home, ".local/share/fnm/node-versions", fnmDir, "installation/bin/claude");
      if (fs.existsSync(stable)) {
        cachedClaudePath = stable;
        return cachedClaudePath;
      }
    }
  } catch {}

  // 2. Try nvm
  try {
    const nvmDir = path.join(home, ".nvm/versions/node");
    const version = fs.readdirSync(nvmDir).sort().pop();
    if (version) {
      const nvmPath = path.join(nvmDir, version, "bin/claude");
      if (fs.existsSync(nvmPath)) {
        cachedClaudePath = nvmPath;
        return cachedClaudePath;
      }
    }
  } catch {}

  // 3. Try system PATH
  try {
    const which = execSync("which claude 2>/dev/null", { encoding: "utf-8", timeout: 3000 }).trim();
    // Only accept if it's not a temp fnm_multishells path
    if (which && !which.includes("fnm_multishells")) {
      cachedClaudePath = which;
      return cachedClaudePath;
    }
  } catch {}

  // 4. Last resort — hope login shell finds it
  return "claude";
}

// Known model IDs — reject anything not in this list to prevent shell injection
const ALLOWED_MODELS = new Set([
  "glm-5.1", "glm-5-turbo", "glm-5", "glm-5v-turbo",
  "glm-4.7", "glm-4.7-flashx", "glm-4.7-flash",
]);

function launchClaude(model) {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, message: "API key not set — open Settings" };

  // Validate model against allowlist — prevents shell injection via model param
  if (!ALLOWED_MODELS.has(model)) {
    return { success: false, message: `Unknown model: ${model}` };
  }

  const claudeBin = resolveClaudePath();

  // Use bash -l (login shell) so fnm/nvm PATH is loaded.
  // Keep terminal open after exit so errors are visible.
  // NOTE: No API key or env vars interpolated into this string —
  // they're passed via spawn env to avoid shell injection.
  // Binary path is quoted to handle spaces/special characters.
  const shellCmd =
    `"${claudeBin}" --model ${model} --dangerously-skip-permissions; ` +
    `exec $SHELL`;

  // Terminal emulators in priority order — all use bash -l for proper env
  const terminals = [
    { cmd: "ghostty",       args: ["-e", "bash", "-l", "-c", shellCmd] },
    { cmd: "kitty",         args: ["bash", "-l", "-c", shellCmd] },
    { cmd: "alacritty",     args: ["-e", "bash", "-l", "-c", shellCmd] },
    { cmd: "gnome-terminal", args: ["--", "bash", "-l", "-c", shellCmd] },
    { cmd: "konsole",       args: ["-e", "bash", "-l", "-c", shellCmd] },
    { cmd: "xdg-terminal-exec", args: ["bash", "-l", "-c", shellCmd] },
  ];

  // Spawn with full user env + claude-glm vars injected directly (no shell interpolation)
  const spawnEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: "http://localhost:9147",
    ANTHROPIC_API_KEY: apiKey,
  };

  for (const term of terminals) {
    try {
      const child = spawn(term.cmd, term.args, {
        detached: true,
        stdio: "ignore",
        env: spawnEnv,
      });
      child.unref();
      return { success: true, message: `Launched with ${model} via ${term.cmd}` };
    } catch (err) {
      continue;
    }
  }

  return {
    success: false,
    message: "No terminal emulator found. Install ghostty, kitty, or gnome-terminal.",
  };
}

// ── Tray Icon ──────────────────────────────────────────
//
// 64x64 SDF-rendered icon: gradient rounded square with a "bridge" symbol.
// Two connected nodes (orange ← → indigo) represent Claude ↔ GLM proxy.
// Uses signed distance fields for crisp anti-aliased edges at any scale.
//
function makeTrayIcon() {
  const pngBuffer = generateTrayPNG();
  return nativeImage.createFromBuffer(pngBuffer, { width: 64, height: 64 });
}

function generateTrayPNG() {
  const S = 64;
  const pixels = Buffer.alloc(S * S * 4);

  // Background gradient: warm amber → cool violet (the bridge direction)
  const c1 = [180, 83, 9];     // Amber-700
  const c2 = [91, 33, 182];    // Violet-800

  const mid = S / 2;   // 32
  const m = 4;          // margin
  const cr = 14;        // corner radius

  // Symbol: two connected nodes (dumbbell / bridge)
  const spread = 13;    // center-to-node distance
  const nr = 7;         // node radius
  const lw = 2.5;       // connecting bar half-height

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const px = x + 0.5, py = y + 0.5;

      // ── Background SDF ──
      const bgD = sdfRoundedRect(px, py, mid, mid, mid - m, mid - m, cr);

      // ── Symbol SDF (union: two circles + connecting bar) ──
      const cd1 = Math.sqrt((px - (mid - spread)) ** 2 + (py - mid) ** 2) - nr;
      const cd2 = Math.sqrt((px - (mid + spread)) ** 2 + (py - mid) ** 2) - nr;

      const bdx = Math.abs(px - mid) - spread;
      const bdy = Math.abs(py - mid) - lw;
      const barD = Math.sqrt(Math.max(bdx, 0) ** 2 + Math.max(bdy, 0) ** 2)
        + Math.min(Math.max(bdx, bdy), 0);

      const symD = Math.min(cd1, cd2, barD);

      // ── Anti-aliased alpha from SDF ──
      const bgA = sdfAlpha(bgD);
      const symA = sdfAlpha(symD);

      // ── Gradient color at this position ──
      const t = Math.max(0, Math.min(1, (x - m) / (S - 2 * m)));
      let gr = lerp(c1[0], c2[0], t);
      let gg = lerp(c1[1], c2[1], t);
      let gb = lerp(c1[2], c2[2], t);

      // Subtle radial highlight (top-center, simulates light source)
      const hlDist = Math.sqrt(((px - mid) / mid) ** 2 + ((py - mid + 5) / mid) ** 2);
      const hl = Math.max(0, 1 - hlDist * 1.2) * 0.15;
      gr += (255 - gr) * hl;
      gg += (255 - gg) * hl;
      gb += (255 - gb) * hl;

      // Thin bright outline at the edge (visibility on dark trays)
      const edgeGlow = bgD > -2.5 && bgD < -0.5 ? (1 - Math.abs(bgD + 1.5) / 1) * 0.08 : 0;
      gr += (255 - gr) * edgeGlow;
      gg += (255 - gg) * edgeGlow;
      gb += (255 - gb) * edgeGlow;

      // ── Composite: white symbol over gradient background ──
      const sa = symA / 255;
      gr += (255 - gr) * sa;
      gg += (255 - gg) * sa;
      gb += (255 - gb) * sa;

      pixels[i]     = clamp8(gr);
      pixels[i + 1] = clamp8(gg);
      pixels[i + 2] = clamp8(gb);
      pixels[i + 3] = bgA;
    }
  }

  return encodePNG(pixels, S, S);
}

// ── Icon Helpers (SDF rendering) ───────────────────────
function sdfRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) - r
    + Math.min(Math.max(qx, qy), 0);
}

function sdfAlpha(d) {
  return Math.max(0, Math.min(255, Math.round((0.5 - d) * 255)));
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp8(v) { return Math.round(Math.max(0, Math.min(255, v))); }

function encodePNG(pixels, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Window ─────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 400,
    minHeight: 580,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: "#100E0C",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: makeTrayIcon(),
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("close", (e) => {
    if (app.quitting) {
      return;
    }
    e.preventDefault();
    mainWindow.hide();
  });
}

// ── Tray Menu ──────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open Claude GLM", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: proxyRunning ? "● Proxy Running" : "○ Proxy Stopped", enabled: false },
    {
      label: proxyRunning ? "Stop Proxy" : "Start Proxy",
      click: async () => { proxyRunning ? await stopProxy() : await startProxy(); updateTrayMenu(); },
    },
    { type: "separator" },
    { label: "GLM-5.1 (Flagship)", click: () => launchClaude("glm-5.1") },
    { label: "GLM-5-Turbo (Coding)", click: () => launchClaude("glm-5-turbo") },
    { label: "GLM-4.7-Flash (Free)", click: () => launchClaude("glm-4.7-flash") },
    { type: "separator" },
    { label: "Quit", click: () => { app.quitting = true; stopProxy(); app.quit(); } },
  ]);
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip("Claude GLM");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC Handlers ───────────────────────────────────────
function setupIPC() {
  ipcMain.handle("check-status", async () => {
    const running = await checkProxyStatus();
    proxyRunning = running;
    if (running && !startTime) startTime = Date.now();
    updateTrayMenu();
    return { running, uptime: getUptime() };
  });

  ipcMain.handle("start-proxy", async () => {
    try { const r = await startProxy(); updateTrayMenu(); return r; }
    catch (err) { return { success: false, message: err.message }; }
  });

  ipcMain.handle("stop-proxy", async () => {
    const r = await stopProxy(); updateTrayMenu(); return r;
  });

  ipcMain.handle("launch-claude", async (_, model) => launchClaude(model));
  ipcMain.handle("get-api-key", async () => getApiKey());
  ipcMain.handle("set-api-key", async (_, key) => { setApiKey(key); return { success: true }; });
  ipcMain.handle("get-platform", async () => process.platform);
  ipcMain.handle("get-proxy-path", async () => PROXY_PATH);
  ipcMain.handle("get-claude-version", async () => getClaudeVersion());
  ipcMain.handle("get-node-version", async () => process.version);
  ipcMain.handle("minimize-window", async () => { mainWindow?.hide(); });
  ipcMain.handle("close-window", async () => { mainWindow?.hide(); });
  ipcMain.handle("show-window", async () => { mainWindow?.show(); mainWindow?.focus(); });
  ipcMain.handle("quit-app", async () => { app.quitting = true; await stopProxy(); app.quit(); });
}

// ── Single Instance ────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

// Initialize app.quitting flag BEFORE any handlers that might check it
app.quitting = false;

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── App Lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  // Load saved API key FIRST so IPC handlers can access it
  const cfg = loadConfig();
  if (cfg.apiKey) process.env.ZAI_API_KEY = cfg.apiKey;

  setupIPC();
  createWindow();
  createTray();

  // Check if proxy is already running (internal state only — renderer pulls via IPC)
  checkProxyStatus().then((running) => {
    proxyRunning = running;
    if (running) { startTime = Date.now(); startUptimeTracker(); }
    updateTrayMenu();
  });
});

app.on("before-quit", () => { app.quitting = true; stopProxy(); });
app.on("window-all-closed", () => { /* keep in tray */ });
app.on("activate", () => { mainWindow?.show(); mainWindow?.focus(); });
