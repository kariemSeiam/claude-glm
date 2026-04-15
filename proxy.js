/**
 * claude-glm-proxy — Thin interceptor for Claude Code ↔ Z.AI GLM
 *
 * Claude Code's Anthropic SDK sends:  x-api-key: <key>
 * Z.AI's Anthropic endpoint expects:  Authorization: Bearer <key>
 *
 * This proxy sits between them. Rewrites the auth header.
 * Everything else — streaming, tools, system prompts — passes through unchanged.
 *
 * Usage:
 *   node proxy.js              # starts on http://localhost:9147
 *   Then set ANTHROPIC_BASE_URL=http://localhost:9147 when launching Claude Code
 */

const http = require("http");
const https = require("https");

const TARGET_HOST = "api.z.ai";
const TARGET_PATH_PREFIX = "/api/anthropic";
const PORT = 9147;
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50MB

const server = http.createServer((req, res) => {
  let body = [];
  let bodySize = 0;

  req.on("data", (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      req.destroy();
      if (!res.headersSent) {
        res.writeHead(413, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "payload_too_large", message: `Request body exceeds ${MAX_BODY_SIZE / 1024 / 1024}MB limit` }));
    }
    body.push(chunk);
  });
  req.on("end", () => {
    body = Buffer.concat(body);

    // Rewrite x-api-key → Authorization: Bearer (the only translation needed)
    const headers = { ...req.headers };
    const apiKey = headers["x-api-key"];
    if (apiKey) {
      delete headers["x-api-key"];
      headers["authorization"] = `Bearer ${apiKey}`;
    }
    delete headers["host"];
    delete headers["connection"];

    const targetPath = TARGET_PATH_PREFIX + req.url;

    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: targetPath,
      method: req.method,
      headers,
      rejectUnauthorized: false,
    };

    console.log(`[proxy] ${req.method} ${targetPath}`);

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "gateway_timeout", message: "Upstream request timed out after 30s" }));
    });

    proxyReq.on("error", (err) => {
      console.error(`[proxy] ERROR: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║         claude-glm-proxy is running              ║
  ╠══════════════════════════════════════════════════╣
  ║  Local:  http://localhost:${PORT}                   ║
  ║  Target: https://${TARGET_HOST}${TARGET_PATH_PREFIX}    ║
  ║  Auth:   x-api-key → Authorization: Bearer      ║
  ╚══════════════════════════════════════════════════╝

  Launch Claude Code with:
    ANTHROPIC_BASE_URL=http://localhost:${PORT} \\
    ANTHROPIC_API_KEY=<your-zai-key> \\
    claude --model glm-5.1

  Press Ctrl+C to stop.
`);
});
