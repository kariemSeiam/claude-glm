// ═══════════════════════════════════════════════════
// Claude GLM — Session Reader Module
// ═══════════════════════════════════════════════════
//
// Reads Claude Code session files and exposes data via IPC.
// Works standalone (no Electron dependency) for CLI reuse.
//
// Streams JSONL files line-by-line to handle large sessions
// without loading entire files into memory.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");

// ── Paths ──────────────────────────────────────────────
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

// ── Pricing (per million tokens, USD) ──────────────────
const PRICING = {
  "glm-5.1": { input: 1.40, output: 4.40 },
  "glm-5-turbo": { input: 1.20, output: 4.00 },
  "glm-5": { input: 1.20, output: 4.00 },
  "glm-5v-turbo": { input: 1.20, output: 4.00 },
  "glm-4.7": { input: 0.50, output: 1.50 },
  "glm-4.7-flashx": { input: 0.10, output: 0.30 },
  "glm-4.7-flash": { input: 0, output: 0 },
};

const DEFAULT_PRICING = { input: 1.20, output: 4.00 };

// ── Cache ───────────────────────────────────────────────
let sessionsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 30000; // 30 seconds

// ── Helpers ─────────────────────────────────────────────

/**
 * Decode project directory name from Claude Code's encoding.
 * "-home-pigo-workspace" → "/home/pigo/workspace"
 */
function decodeProjectDir(dirName) {
  return dirName.split("-").map(s => {
    if (s === "") return "";
    if (s.startsWith("_")) return s.slice(1);
    return s;
  }).join("/");
}

/**
 * Find the project directory containing a specific session.
 * Scans all project dirs for {sessionId}.jsonl files.
 */
function findProjectDir(sessionId) {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR);
    for (const project of projects) {
      const sessionFile = path.join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
      if (fs.existsSync(sessionFile)) {
        return { projectDir: decodeProjectDir(project), sessionFile };
      }
    }
  } catch (err) {
    console.error("[session-reader] Error scanning projects:", err.message);
  }
  return null;
}

/**
 * Stream-read a JSONL file and process each line.
 * Handles malformed JSON gracefully by skipping bad lines.
 */
async function readJSONL(filePath, lineCallback) {
  if (!fs.existsSync(filePath)) return [];

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const results = [];
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);
      const processed = lineCallback(data, lineNumber);
      if (processed !== undefined) {
        results.push(processed);
      }
    } catch (err) {
      console.error(`[session-reader] Malformed JSON at ${filePath}:${lineNumber}`, err.message);
      // Skip malformed lines
    }
  }

  return results;
}

/**
 * Extract text content from a message content field.
 * Handles both string content and array of content blocks.
 */
function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === "text")
      .map(block => block.text || "")
      .join("\n");
  }
  return "";
}

/**
 * Calculate cost from token counts and model.
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// ── API ────────────────────────────────────────────────

/**
 * Get all Claude Code sessions across all projects.
 * Returns array sorted by lastActivity (most recent first).
 */
async function getAllSessions() {
  // Check cache
  if (sessionsCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return sessionsCache;
  }

  const sessions = [];
  const processedSessionIds = new Set();

  try {
    // Scan projects for session files
    const projects = fs.readdirSync(PROJECTS_DIR);

    for (const project of projects) {
      const projectPath = path.join(PROJECTS_DIR, project);
      const projectDir = decodeProjectDir(project);

      try {
        const files = fs.readdirSync(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));

        for (const jsonlFile of jsonlFiles) {
          const sessionId = jsonlFile.replace(".jsonl", "");

          // Avoid duplicates if session appears in multiple projects
          if (processedSessionIds.has(sessionId)) continue;
          processedSessionIds.add(sessionId);

          const sessionPath = path.join(projectPath, jsonlFile);
          const session = await parseSessionMetadata(sessionPath, sessionId, projectDir);
          if (session) {
            sessions.push(session);
          }
        }
      } catch (err) {
        console.error(`[session-reader] Error reading project ${project}:`, err.message);
      }
    }

    // Sort by lastActivity descending
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    sessionsCache = sessions;
    cacheTimestamp = Date.now();

    return sessions;
  } catch (err) {
    console.error("[session-reader] Error scanning sessions:", err.message);
    return [];
  }
}

/**
 * Parse session metadata from JSONL file.
 */
async function parseSessionMetadata(filePath, sessionId, projectDir) {
  let startedAt = null;
  let lastActivity = null;
  let model = null;
  let messageCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cwd = null;

  await readJSONL(filePath, (data) => {
    const msg = data.message || data;

    // Extract timestamps
    const timestamp = msg.timestamp || msg.createdAt;
    if (timestamp) {
      if (!startedAt || new Date(timestamp) < new Date(startedAt)) {
        startedAt = timestamp;
      }
      if (!lastActivity || new Date(timestamp) > new Date(lastActivity)) {
        lastActivity = timestamp;
      }
    }

    // Extract working directory
    if (!cwd && msg.cwd) {
      cwd = msg.cwd;
    }

    // Count messages and tokens from assistant responses
    if (msg.role === "assistant" && msg.usage) {
      messageCount++;
      if (msg.model) model = msg.model;
      if (msg.usage.input_tokens) totalInputTokens += msg.usage.input_tokens;
      if (msg.usage.output_tokens) totalOutputTokens += msg.usage.output_tokens;
    } else if (msg.role === "user") {
      messageCount++;
    }
  });

  if (!startedAt) return null;

  return {
    sessionId,
    projectDir,
    cwd: cwd || projectDir,
    startedAt,
    lastActivity,
    model,
    messageCount,
    totalInputTokens,
    totalOutputTokens,
  };
}

/**
 * Get chat history for a specific session.
 * Returns array of message objects (user + assistant only).
 */
async function getSessionMessages(sessionId, projectDir) {
  // Find the session file
  const result = findProjectDir(sessionId);
  if (!result) return [];

  const { sessionFile } = result;

  const messages = await readJSONL(sessionFile, (data) => {
    const msg = data.message || data;
    const role = msg.role;

    if (role !== "user" && role !== "assistant") return undefined;

    const content = extractTextContent(msg.content);
    const timestamp = msg.timestamp || msg.createdAt;

    const result = {
      type: role,
      content,
      timestamp,
    };

    if (role === "assistant") {
      result.model = msg.model;
      if (msg.usage) {
        result.tokens = {
          input: msg.usage.input_tokens || 0,
          output: msg.usage.output_tokens || 0,
        };
      }
    }

    return result;
  });

  // Return last 100 messages for performance
  return messages.slice(-100);
}

/**
 * Get usage summary grouped by date for the last N days.
 */
async function getUsageSummary(days = 7) {
  const sessions = await getAllSessions();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const summary = {};

  for (const session of sessions) {
    const startedAt = new Date(session.startedAt);
    if (startedAt < cutoffDate) continue;

    const dateKey = startedAt.toISOString().split("T")[0];
    const model = session.model || "unknown";

    if (!summary[dateKey]) {
      summary[dateKey] = {
        date: dateKey,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        models: {},
      };
    }

    summary[dateKey].inputTokens += session.totalInputTokens;
    summary[dateKey].outputTokens += session.totalOutputTokens;

    if (!summary[dateKey].models[model]) {
      summary[dateKey].models[model] = {
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    summary[dateKey].models[model].inputTokens += session.totalInputTokens;
    summary[dateKey].models[model].outputTokens += session.totalOutputTokens;

    summary[dateKey].cost += calculateCost(
      model,
      session.totalInputTokens,
      session.totalOutputTokens
    );
  }

  // Convert to array and sort by date descending
  return Object.values(summary).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get detailed statistics for a specific session.
 */
async function getSessionStats(sessionId, projectDir) {
  const result = findProjectDir(sessionId);
  if (!result) return null;

  const { sessionFile } = result;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let messageCount = 0;
  let modelStats = {};
  let startedAt = null;
  let lastActivity = null;
  let contextWindowPeak = 0;
  let currentContextWindow = 0;

  await readJSONL(sessionFile, (data) => {
    const msg = data.message || data;
    const role = msg.role;
    const timestamp = msg.timestamp || msg.createdAt;

    if (timestamp) {
      if (!startedAt) startedAt = timestamp;
      lastActivity = timestamp;
    }

    if (role === "assistant" && msg.usage) {
      messageCount++;
      const model = msg.model || "unknown";
      const inputTokens = msg.usage.input_tokens || 0;
      const outputTokens = msg.usage.output_tokens || 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCost += calculateCost(model, inputTokens, outputTokens);

      if (!modelStats[model]) {
        modelStats[model] = {
          inputTokens: 0,
          outputTokens: 0,
          messages: 0,
          cost: 0,
        };
      }

      modelStats[model].inputTokens += inputTokens;
      modelStats[model].outputTokens += outputTokens;
      modelStats[model].messages += 1;
      modelStats[model].cost += calculateCost(model, inputTokens, outputTokens);

      // Track context window usage
      currentContextWindow += inputTokens;
      if (currentContextWindow > contextWindowPeak) {
        contextWindowPeak = currentContextWindow;
      }
    } else if (role === "user") {
      messageCount++;
      // Reset context window tracking for new user message
      currentContextWindow = 0;
    }
  });

  if (!startedAt) return null;

  const duration = lastActivity ? new Date(lastActivity) - new Date(startedAt) : 0;

  return {
    sessionId,
    projectDir,
    startedAt,
    lastActivity,
    duration,
    messageCount,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    contextWindowPeak,
    modelStats,
  };
}

// ── Exports ─────────────────────────────────────────────
module.exports = {
  getAllSessions,
  getSessionMessages,
  getUsageSummary,
  getSessionStats,
  // Export for testing
  _test: {
    decodeProjectDir,
    extractTextContent,
    calculateCost,
    clearCache: () => { sessionsCache = null; cacheTimestamp = null; },
  },
};
