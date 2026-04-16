const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeGLM", {
  // Proxy management
  checkStatus: () => ipcRenderer.invoke("check-status"),
  startProxy: () => ipcRenderer.invoke("start-proxy"),
  stopProxy: () => ipcRenderer.invoke("stop-proxy"),

  // Claude Code launch
  launchClaude: (model) => ipcRenderer.invoke("launch-claude", model),

  // API key
  getApiKey: () => ipcRenderer.invoke("get-api-key"),
  setApiKey: (key) => ipcRenderer.invoke("set-api-key", key),

  // Platform/Version info
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  getClaudeVersion: () => ipcRenderer.invoke("get-claude-version"),
  getNodeVersion: () => ipcRenderer.invoke("get-node-version"),

  // Window
  minimize: () => ipcRenderer.invoke("minimize-window"),
  close: () => ipcRenderer.invoke("close-window"),
  show: () => ipcRenderer.invoke("show-window"),
  quit: () => ipcRenderer.invoke("quit-app"),

  // Session reading
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  getSessionMessages: (sessionId, projectDir) =>
    ipcRenderer.invoke("get-session-messages", sessionId, projectDir),
  getUsageSummary: (days) => ipcRenderer.invoke("get-usage-summary", days),
  getSessionStats: (sessionId, projectDir) =>
    ipcRenderer.invoke("get-session-stats", sessionId, projectDir),

  // Events
  onProxyStatusChanged: (callback) => {
    ipcRenderer.on("proxy-status-changed", (_, running, uptime) =>
      callback(running, uptime)
    );
  },
  onUptimeUpdate: (callback) => {
    ipcRenderer.on("uptime-update", (_, uptime) => callback(uptime));
  },
});
