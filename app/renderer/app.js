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
    if (platform === "win32") {
      cmd = `$env:ANTHROPIC_API_KEY="${apiKey}"; $env:ANTHROPIC_BASE_URL="http://localhost:9147"; claude --model ${modelId} --dangerously-skip-permissions`;
    } else {
      cmd = `ANTHROPIC_API_KEY=${apiKey} ANTHROPIC_BASE_URL=http://localhost:9147 claude --model ${modelId} --dangerously-skip-permissions`;
    }

    await navigator.clipboard.writeText(cmd);

    // Brief visual feedback on the button
    btnEl.classList.add("copied");
    setTimeout(() => btnEl.classList.remove("copied"), 1500);

    showToast("Command copied", "success");
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

  // Show versions
  try {
    dom.nodeVersion.textContent =
      typeof process !== "undefined" ? process.version : "N/A (renderer)";
  } catch {
    dom.nodeVersion.textContent = "—";
  }
  dom.claudeVersion.textContent = "—";
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

// ── Init ────────────────────────────────────────────
async function init() {
  renderModels();

  // Initial UI state: "Checking..." until first status response arrives
  dom.statusLabel.textContent = "Checking...";
  dom.statusLabel.className = "status-label";

  // Check API key
  const key = await window.claudeGLM.getApiKey();
  if (!key) {
    dom.apiKeyWarning.classList.remove("hidden");
  }

  // Pull initial proxy status from main process
  await checkStatus();

  // Start slow fallback polling
  startPolling();
}

init();
