// ═══════════════════════════════════════════════════
// Claude GLM Desktop — Renderer
// ═══════════════════════════════════════════════════

// ── Model Definitions (best → lowest) ──────────────
const MODELS = [
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    tier: "flagship",
    badge: "FLAGSHIP",
    desc: "Complex tasks, deep reasoning",
    price: "$1.40 / $4.40",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    tier: "coding",
    badge: "CODING",
    desc: "Optimized for tool use & coding",
    price: "$1.20 / $4.00",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-5",
    name: "GLM-5",
    tier: "general",
    badge: "GENERAL",
    desc: "Versatile flagship model",
    price: "$1.20 / $4.00",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-5v-turbo",
    name: "GLM-5V-Turbo",
    tier: "vision",
    badge: "VISION",
    desc: "Vision + reasoning capabilities",
    price: "$1.20 / $4.00",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    tier: "balanced",
    badge: "BALANCED",
    desc: "Solid all-rounder",
    price: "$0.50 / $1.50",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-4.7-flashx",
    name: "GLM-4.7-FlashX",
    tier: "budget",
    badge: "BUDGET",
    desc: "Cheapest paid option",
    price: "$0.10 / $0.30",
    priceNote: "per 1M tokens in/out",
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash",
    tier: "free",
    badge: "FREE",
    desc: "Quick lookups, simple tasks",
    price: "FREE",
    priceNote: "Unlimited",
  },
];

// ── State ───────────────────────────────────────────
let proxyRunning = false;
let statusPolling = null;
let firstStatusReceived = false;
let currentTab = "launch";
let sessionsData = [];
let currentUsagePeriod = 7;

// ── DOM Refs ────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
  statusDot: $("statusDot"),
  statusPulse: $("statusPulse"),
  statusLabel: $("statusLabel"),
  uptimeLabel: $("uptimeLabel"),
  serverCard: $("serverCard"),
  serverBtn: $("serverBtn"),
  serverBtnIcon: $("serverBtnIcon"),
  serverBtnText: $("serverBtnText"),
  modelsList: $("modelsList"),
  apiKeyWarning: $("apiKeyWarning"),
  settingsBtn: $("settingsBtn"),
  settingsOverlay: $("settingsOverlay"),
  settingsCloseBtn: $("settingsCloseBtn"),
  apiKeyInput: $("apiKeyInput"),
  saveApiKeyBtn: $("saveApiKeyBtn"),
  proxyPortInput: $("proxyPortInput"),
  proxyPathDisplay: $("proxyPathDisplay"),
  nodeVersion: $("nodeVersion"),
  claudeVersion: $("claudeVersion"),
  minimizeBtn: $("minimizeBtn"),
  closeBtn: $("closeBtn"),
  quitBtn: $("quitBtn"),
  toastContainer: $("toastContainer"),
  sessionDetailOverlay: $("sessionDetailOverlay"),
  sessionDetailCloseBtn: $("sessionDetailCloseBtn"),
  sessionDetailBody: $("sessionDetailBody"),
  sessionDetailTitle: $("sessionDetailTitle"),
  resumeSessionBtn: $("resumeSessionBtn"),
};

// ── Toast System ────────────────────────────────────
function showToast(message, type = "success", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "✓" : "✕";
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <span>${message}</span>
  `;

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 150);
  }, duration);
}

// ── Server Status ───────────────────────────────────
function updateServerUI(running) {
  proxyRunning = running;
  firstStatusReceived = true;

  // Status dot
  dom.statusDot.className = `status-dot ${running ? "running" : "stopped"}`;
  dom.statusPulse.className = `status-pulse ${running ? "" : "hidden"}`;

  // Status label
  dom.statusLabel.textContent = running ? "Running" : "Stopped";
  dom.statusLabel.className = `status-label ${running ? "running" : "stopped"}`;

  // Server card border
  dom.serverCard.className = `server-card ${running ? "running" : ""}`;

  // Button
  if (running) {
    dom.serverBtn.className = "server-btn stop";
    dom.serverBtnIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>`;
    dom.serverBtnText.textContent = "Stop Server";
  } else {
    dom.serverBtn.className = "server-btn";
    dom.serverBtnIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2.5v9l7.5-4.5L4 2.5z" fill="currentColor"/></svg>`;
    dom.serverBtnText.textContent = "Start Server";
  }
}

async function checkStatus() {
  try {
    const result = await window.claudeGLM.checkStatus();
    updateServerUI(result.running);
    if (result.uptime) {
      dom.uptimeLabel.textContent = result.uptime;
    } else {
      dom.uptimeLabel.textContent = "";
    }
  } catch (err) {
    updateServerUI(false);
    dom.uptimeLabel.textContent = "";
  }
}

function startPolling() {
  stopPolling();
  // Slow fallback poll — status updates normally come via push events.
  // This catches edge cases where an event is missed.
  statusPolling = setInterval(checkStatus, 30000);
}

function stopPolling() {
  if (statusPolling) {
    clearInterval(statusPolling);
    statusPolling = null;
  }
}

// ── Model Cards ─────────────────────────────────────
function renderModels() {
  dom.modelsList.innerHTML = "";

  MODELS.forEach((model) => {
    const card = document.createElement("div");
    card.className = "model-card";
    card.dataset.tier = model.tier;

    const isFree = model.tier === "free";

    card.innerHTML = `
      <div class="model-info">
        <div class="model-top">
          <span class="model-name">${model.name}</span>
          <span class="model-badge ${model.tier}">${model.badge}</span>
        </div>
        <div class="model-desc">${model.desc}</div>
        <div class="model-price ${isFree ? "free-price" : ""}">${model.price}${isFree ? "" : " " + model.priceNote}</div>
      </div>
      <div class="model-actions">
        <button class="copy-btn" data-model="${model.id}" title="Copy launch command">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="launch-btn" data-model="${model.id}" title="Launch Claude Code with ${model.name}">
          Launch
          <span class="btn-arrow">→</span>
        </button>
      </div>
    `;

    dom.modelsList.appendChild(card);
  });

  // Bind copy buttons
  dom.modelsList.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleCopyCommand(btn.dataset.model, btn);
    });
  });

  // Bind launch buttons
  dom.modelsList.querySelectorAll(".launch-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleLaunch(btn.dataset.model, btn);
    });
  });
}

async function handleCopyCommand(modelId, btnEl) {
  try {
    const apiKey = await window.claudeGLM.getApiKey();
    if (!apiKey) {
      showToast("Set API key in Settings first", "error");
      return;
    }

    const platform = await window.claudeGLM.getPlatform();
    let cmd;
    // Use environment variable reference instead of literal key for security
    if (platform === "win32") {
      cmd = `$env:ANTHROPIC_API_KEY="$env:ZAI_API_KEY"; $env:ANTHROPIC_BASE_URL="http://localhost:9147"; claude --model ${modelId} --dangerously-skip-permissions`;
    } else {
      cmd = `ANTHROPIC_API_KEY=$ZAI_API_KEY ANTHROPIC_BASE_URL=http://localhost:9147 claude --model ${modelId} --dangerously-skip-permissions`;
    }

    await navigator.clipboard.writeText(cmd);

    // Brief visual feedback on the button
    btnEl.classList.add("copied");
    setTimeout(() => btnEl.classList.remove("copied"), 1500);

    showToast("Command copied — set $ZAI_API_KEY env var first", "success");
  } catch (err) {
    showToast("Failed to copy", "error");
  }
}

async function handleLaunch(modelId, btnEl) {
  const originalHTML = btnEl.innerHTML;
  btnEl.classList.add("launching");
  btnEl.innerHTML = "Starting...";

  try {
    // Check proxy, start if needed
    const status = await window.claudeGLM.checkStatus();
    if (!status.running) {
      btnEl.innerHTML = "Starting proxy...";
      const startResult = await window.claudeGLM.startProxy();
      if (!startResult.success) {
        showToast(`Proxy failed: ${startResult.message}`, "error");
        btnEl.classList.remove("launching");
        btnEl.innerHTML = originalHTML;
        return;
      }
      // Poll for proxy readiness instead of blind delay
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const s = await window.claudeGLM.checkStatus();
        if (s.running) { ready = true; break; }
      }
      if (!ready) {
        showToast("Proxy failed to start", "error");
        btnEl.classList.remove("launching");
        btnEl.innerHTML = originalHTML;
        return;
      }
    }

    btnEl.innerHTML = "Launching...";
    const result = await window.claudeGLM.launchClaude(modelId);

    if (result.success) {
      const modelName = MODELS.find((m) => m.id === modelId)?.name || modelId;
      showToast(`Launched with ${modelName}`, "success");
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast(err.message || "Launch failed", "error");
  }

  // Reset button
  setTimeout(() => {
    btnEl.classList.remove("launching");
    btnEl.innerHTML = originalHTML;
  }, 1200);
}

// ── Server Button ───────────────────────────────────
dom.serverBtn.addEventListener("click", async () => {
  dom.serverBtn.disabled = true;

  try {
    if (proxyRunning) {
      dom.serverBtnText.textContent = "Stopping...";
      const result = await window.claudeGLM.stopProxy();
      if (result.success) {
        showToast("Proxy stopped", "success");
      }
    } else {
      dom.serverBtnText.textContent = "Starting...";
      const result = await window.claudeGLM.startProxy();
      if (result.success) {
        showToast("Proxy started on port 9147", "success");
      } else {
        showToast(`Failed: ${result.message}`, "error");
      }
    }
    await checkStatus();
  } catch (err) {
    showToast(err.message, "error");
  }

  dom.serverBtn.disabled = false;
});

// ── Settings ────────────────────────────────────────
dom.settingsBtn.addEventListener("click", () => {
  dom.settingsOverlay.classList.remove("hidden");
  loadSettings();
});

dom.settingsCloseBtn.addEventListener("click", () => {
  dom.settingsOverlay.classList.add("hidden");
});

dom.settingsOverlay.addEventListener("click", (e) => {
  if (e.target === dom.settingsOverlay) {
    dom.settingsOverlay.classList.add("hidden");
  }
});

async function loadSettings() {
  const key = await window.claudeGLM.getApiKey();
  dom.apiKeyInput.value = key || "";

  try {
    const proxyPath = await window.claudeGLM.getProxyPath();
    dom.proxyPathDisplay.textContent = proxyPath;
  } catch {}

  // Show versions — fetch from main process via IPC
  try {
    const nodeVer = await window.claudeGLM.getNodeVersion();
    dom.nodeVersion.textContent = nodeVer || "—";
  } catch {
    dom.nodeVersion.textContent = "—";
  }

  try {
    const claudeVer = await window.claudeGLM.getClaudeVersion();
    dom.claudeVersion.textContent = claudeVer || "—";
  } catch {
    dom.claudeVersion.textContent = "—";
  }
}

dom.saveApiKeyBtn.addEventListener("click", async () => {
  const key = dom.apiKeyInput.value.trim();
  if (key) {
    await window.claudeGLM.setApiKey(key);
    dom.saveApiKeyBtn.textContent = "Saved ✓";
    dom.saveApiKeyBtn.classList.add("saved");
    dom.apiKeyWarning.classList.add("hidden");
    setTimeout(() => {
      dom.saveApiKeyBtn.textContent = "Save Key";
      dom.saveApiKeyBtn.classList.remove("saved");
    }, 1500);
  }
});

// ── Window Controls ─────────────────────────────────
dom.minimizeBtn.addEventListener("click", () => {
  window.claudeGLM.minimize();
});

dom.closeBtn.addEventListener("click", () => {
  window.claudeGLM.close();
});

dom.quitBtn.addEventListener("click", () => {
  window.claudeGLM.quit();
});

// ── Events from Main Process ────────────────────────
window.claudeGLM.onProxyStatusChanged((running, uptime) => {
  updateServerUI(running);
  if (uptime) dom.uptimeLabel.textContent = uptime;
});

window.claudeGLM.onUptimeUpdate((uptime) => {
  dom.uptimeLabel.textContent = uptime;
});

// ── Keyboard Shortcuts ───────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!dom.sessionDetailOverlay.classList.contains("hidden")) {
      dom.sessionDetailOverlay.classList.add("hidden");
      return;
    }
    if (!dom.settingsOverlay.classList.contains("hidden")) {
      dom.settingsOverlay.classList.add("hidden");
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === ",") {
    e.preventDefault();
    dom.settingsOverlay.classList.remove("hidden");
    loadSettings();
  }
});

// ── Tab Navigation ───────────────────────────────────
function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;

      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      panels.forEach((p) => p.classList.remove("active"));
      document.getElementById(`panel-${tabId}`).classList.add("active");

      currentTab = tabId;

      if (tabId === "sessions") {
        loadSessions();
      } else if (tabId === "usage") {
        loadUsage(currentUsagePeriod);
      }
    });
  });
}

// ── Sessions Panel ───────────────────────────────────
async function loadSessions() {
  const sessionsList = document.getElementById("sessionsList");

  sessionsList.innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>
  `;

  try {
    const sessions = await window.claudeGLM.getSessions();
    sessionsData = sessions;

    if (!sessions || sessions.length === 0) {
      sessionsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="empty-state-title">No sessions found</div>
          <div class="empty-state-text">Start a Claude Code session to see it here</div>
        </div>
      `;
      return;
    }

    const visibleSessions = sessions.slice(0, 50);
    sessionsList.innerHTML = visibleSessions.map((session) => {
      return `<div class="session-row" data-session-id="${session.sessionId}">${renderSessionRow(session)}</div>`;
    }).join("");

    if (sessions.length > 50) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.className = "load-more-btn";
      loadMoreBtn.textContent = `Load ${sessions.length - 50} more sessions`;
      loadMoreBtn.addEventListener("click", () => loadAllSessions());
      sessionsList.appendChild(loadMoreBtn);
    }

    sessionsList.querySelectorAll(".session-row").forEach((row) => {
      row.addEventListener("click", () => {
        const sessionId = row.dataset.sessionId;
        const session = sessions.find((s) => s.sessionId === sessionId);
        if (session) showSessionDetail(session);
      });
    });
  } catch (err) {
    sessionsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Failed to load sessions</div>
        <div class="empty-state-text">${err.message}</div>
      </div>
    `;
  }
}

function loadAllSessions() {
  const sessionsList = document.getElementById("sessionsList");
  const loadMoreBtn = sessionsList.querySelector(".load-more-btn");
  if (loadMoreBtn) loadMoreBtn.remove();

  const remainingSessions = sessionsData.slice(50);
  remainingSessions.forEach((session) => {
    const row = document.createElement("div");
    row.className = "session-row";
    row.dataset.sessionId = session.sessionId;
    row.innerHTML = renderSessionRow(session, true);
    sessionsList.appendChild(row);

    row.addEventListener("click", () => {
      showSessionDetail(session);
    });
  });
}

function renderSessionRow(session, isHtml = false) {
  const projectName = session.projectDir ? session.projectDir.split("/").filter(Boolean).pop() || session.projectDir : "Unknown";
  const modelBadge = getModelBadgeClass(session.model);
  const timeAgo = formatRelativeTime(session.startedAt);
  const tokensIn = formatTokens(session.totalInputTokens || 0);
  const tokensOut = formatTokens(session.totalOutputTokens || 0);
  const messageCount = session.messageCount || 0;
  const cost = estimateCost(session.totalInputTokens || 0, session.totalOutputTokens || 0, session.model);

  const html = `
    <div class="session-header">
      <span class="session-project">${escapeHtml(projectName)}</span>
      <span class="session-model-badge ${modelBadge}">${getModelBadgeLabel(session.model)}</span>
    </div>
    <div class="session-meta">
      <span class="session-meta-item">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 3h8M2 6h6M2 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        ${messageCount} messages
      </span>
      <span class="session-meta-item mono">${tokensIn} in / ${tokensOut} out</span>
      <span class="session-meta-item">${timeAgo}</span>
    </div>
    <div class="session-stats">
      <div class="session-stat">
        <span class="session-stat-label">Est. Cost</span>
        <span class="session-stat-value highlight">${cost}</span>
      </div>
    </div>
  `;

  return isHtml ? html : html;
}

function showSessionDetail(session) {
  dom.sessionDetailTitle.textContent = session.sessionId.substring(0, 8);
  dom.sessionDetailBody.innerHTML = renderSessionDetail(session);
  dom.sessionDetailOverlay.classList.remove("hidden");

  dom.resumeSessionBtn.onclick = async () => {
    try {
      const result = await window.claudeGLM.resumeSession(session.sessionId);
      if (result.success) {
        showToast("Session resumed", "success");
        dom.sessionDetailOverlay.classList.add("hidden");
      } else {
        showToast(result.message || "Failed to resume session", "error");
      }
    } catch (err) {
      showToast(err.message || "Failed to resume session", "error");
    }
  };
}

function renderSessionDetail(session) {
  const projectName = session.projectDir ? session.projectDir.split("/").filter(Boolean).pop() || session.projectDir : "Unknown";
  const duration = formatDuration(session.startedAt, session.lastActivity);
  const modelBadge = getModelBadgeClass(session.model);
  const tokensIn = formatTokens(session.totalInputTokens || 0);
  const tokensOut = formatTokens(session.totalOutputTokens || 0);
  const cacheRead = formatTokens(0);
  const cacheWrite = formatTokens(0);
  const cost = estimateCost(session.totalInputTokens || 0, session.totalOutputTokens || 0, session.model);

  return `
    <div class="session-detail-section">
      <div class="session-detail-label">Project</div>
      <div class="session-detail-value">${escapeHtml(projectName)}</div>
    </div>
    <div class="session-detail-section">
      <div class="session-detail-label">Project Path</div>
      <div class="session-detail-value mono">${escapeHtml(session.projectDir || "Unknown")}</div>
    </div>
    <div class="session-detail-section">
      <div class="session-detail-label">Model</div>
      <div class="session-detail-value">
        <span class="session-model-badge ${modelBadge}">${getModelBadgeLabel(session.model)}</span>
      </div>
    </div>
    <div class="session-detail-section">
      <div class="session-detail-label">Duration</div>
      <div class="session-detail-value">${duration}</div>
    </div>
    <div class="session-detail-stats-grid">
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Input Tokens</div>
        <div class="session-detail-stat-value">${tokensIn}</div>
      </div>
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Output Tokens</div>
        <div class="session-detail-stat-value">${tokensOut}</div>
      </div>
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Cache Read</div>
        <div class="session-detail-stat-value">${cacheRead}</div>
      </div>
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Cache Write</div>
        <div class="session-detail-stat-value">${cacheWrite}</div>
      </div>
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Messages</div>
        <div class="session-detail-stat-value">${session.messageCount || 0}</div>
      </div>
      <div class="session-detail-stat">
        <div class="session-detail-stat-label">Est. Cost</div>
        <div class="session-detail-stat-value accent">${cost}</div>
      </div>
    </div>
  `;
}

dom.sessionDetailCloseBtn.addEventListener("click", () => {
  dom.sessionDetailOverlay.classList.add("hidden");
});

dom.sessionDetailOverlay.addEventListener("click", (e) => {
  if (e.target === dom.sessionDetailOverlay) {
    dom.sessionDetailOverlay.classList.add("hidden");
  }
});

// ── Usage Dashboard ──────────────────────────────────
function setupPeriodSelector() {
  const periodBtns = document.querySelectorAll(".period-btn");

  periodBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      periodBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      currentUsagePeriod = parseInt(btn.dataset.period, 10);
      loadUsage(currentUsagePeriod);
    });
  });
}

async function loadUsage(days) {
  const usageContent = document.getElementById("usageContent");

  usageContent.innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>
  `;

  try {
    const summary = await window.claudeGLM.getUsageSummary(days);

    if (!summary || summary.length === 0) {
      usageContent.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="empty-state-title">No usage data</div>
          <div class="empty-state-text">Use Claude Code to see token usage here</div>
        </div>
      `;
      return;
    }

    usageContent.innerHTML = renderUsageDashboard(summary);
  } catch (err) {
    usageContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Failed to load usage</div>
        <div class="empty-state-text">${err.message}</div>
      </div>
    `;
  }
}

function renderUsageDashboard(days) {
  if (!days || days.length === 0) return '<div class="empty-state"><div class="empty-state-title">No usage data</div></div>';

  const totalInput = days.reduce((sum, d) => sum + (d.inputTokens || 0), 0);
  const totalOutput = days.reduce((sum, d) => sum + (d.outputTokens || 0), 0);
  const totalCostDollars = days.reduce((sum, d) => sum + (d.cost || 0), 0);
  const totalCostCents = Math.round(totalCostDollars * 100);
  const avgDailyCents = Math.round(totalCostCents / days.length);

  const summaryCards = `
    <div class="usage-summary">
      <div class="usage-card">
        <div class="usage-card-label">Input Tokens</div>
        <div class="usage-card-value">${formatTokens(totalInput)}</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">Output Tokens</div>
        <div class="usage-card-value">${formatTokens(totalOutput)}</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">Total Cost</div>
        <div class="usage-card-value accent">${formatCurrency(totalCostCents)}</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">Avg Daily</div>
        <div class="usage-card-value accent">${formatCurrency(avgDailyCents)}</div>
      </div>
    </div>
  `;

  let tableHtml = "";
  if (days.length > 0) {
    const sortedDays = [...days].sort((a, b) => b.date.localeCompare(a.date));

    tableHtml = `
      <div class="usage-table">
        <div class="usage-table-header">
          <div class="usage-table-header-cell">Date</div>
          <div class="usage-table-header-cell">Input</div>
          <div class="usage-table-header-cell">Output</div>
          <div class="usage-table-header-cell">Cost</div>
        </div>
        ${sortedDays.map((day) => renderUsageTableRow(day)).join("")}
      </div>
    `;
  }

  return summaryCards + tableHtml;
}

function renderUsageTableRow(day) {
  const date = formatShortDate(day.date);
  const input = formatTokens(day.inputTokens || 0);
  const output = formatTokens(day.outputTokens || 0);
  const costCents = Math.round((day.cost || 0) * 100);
  const cost = formatCurrency(costCents);
  const modelNames = Object.keys(day.models || {});

  const modelBadges = modelNames.map((model) => {
    const badgeClass = getModelBadgeClass(model);
    const label = getModelBadgeLabel(model);
    return `<span class="usage-model-badge ${badgeClass}">${label}</span>`;
  }).join("");

  return `
    <div class="usage-table-row">
      <div class="usage-table-cell">${escapeHtml(date)}</div>
      <div class="usage-table-cell mono">${input}</div>
      <div class="usage-table-cell mono">${output}</div>
      <div class="usage-table-cell mono highlight">${cost}</div>
    </div>
  `;
}

// ── Helpers ──────────────────────────────────────────
function getModelBadgeClass(model) {
  const modelMap = {
    "glm-5.1": "flagship",
    "glm-5-turbo": "coding",
    "glm-5": "general",
    "glm-5v-turbo": "vision",
    "glm-4.7": "balanced",
    "glm-4.7-flashx": "budget",
    "glm-4.7-flash": "free",
  };
  return modelMap[model] || "general";
}

function getModelBadgeLabel(model) {
  const labelMap = {
    "glm-5.1": "FLAGSHIP",
    "glm-5-turbo": "CODING",
    "glm-5": "GENERAL",
    "glm-5v-turbo": "VISION",
    "glm-4.7": "BALANCED",
    "glm-4.7-flashx": "BUDGET",
    "glm-4.7-flash": "FREE",
  };
  return labelMap[model] || "GENERAL";
}

function formatTokens(tokens) {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
}

function formatCurrency(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Unknown";

  const now = Date.now();
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return "Unknown";
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(startTime, endTime) {
  if (!startTime) return "Unknown";

  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  if (isNaN(start)) return "Unknown";
  const diff = end - start;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatShortDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function estimateCost(inputTokens, outputTokens, model) {
  const pricing = {
    "glm-5.1": { input: 1.40, output: 4.40 },
    "glm-5-turbo": { input: 1.20, output: 4.00 },
    "glm-5": { input: 1.20, output: 4.00 },
    "glm-5v-turbo": { input: 1.20, output: 4.00 },
    "glm-4.7": { input: 0.50, output: 1.50 },
    "glm-4.7-flashx": { input: 0.10, output: 0.30 },
    "glm-4.7-flash": { input: 0, output: 0 },
  };

  const prices = pricing[model] || { input: 1.20, output: 4.00 };
  const inputCost = (inputTokens / 1000000) * prices.input;
  const outputCost = (outputTokens / 1000000) * prices.output;
  const totalCents = Math.round((inputCost + outputCost) * 100);

  return formatCurrency(totalCents);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Init ────────────────────────────────────────────
async function init() {
  setupTabs();
  setupPeriodSelector();
  renderModels();

  dom.statusLabel.textContent = "Checking...";
  dom.statusLabel.className = "status-label";

  const key = await window.claudeGLM.getApiKey();
  if (!key) {
    dom.apiKeyWarning.classList.remove("hidden");
  }

  await checkStatus();
  startPolling();
}

init();
