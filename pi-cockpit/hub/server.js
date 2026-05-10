/**
 * PI Cockpit — WebSocket Hub
 *
 * Central server that:
 *   - Serves widget HTML/JS/CSS as static files
 *   - Manages WebSocket connections from widgets and companion plugin
 *   - Broadcasts state changes
 *   - Monitors PI sessions on disk
 *   - Bridges clipboard operations
 *
 * Runs on the Mac Mini, reachable via localhost or Tailscale.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import { state, getSnapshot } from "./state.js";
import { scanSessions, readSessionHistory } from "./session-monitor.js";
import { scanSkills, scanMcpServers, getSkillClipboardText, getMcpClipboardText } from "./skills-monitor.js";
import { getLayout, listLayouts, LAYOUTS } from "./layouts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3099;
const WIDGETS_DIR = join(__dirname, "..", "widgets");

// ── MIME types for static serving ──────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ── Static file server ─────────────────────────────────────
function serveStatic(req, res) {
  let filePath = join(WIDGETS_DIR, req.url === "/" ? "index.html" : req.url);

  // Route /widget/<name> to /widgets/<name>/index.html
  if (req.url.startsWith("/widget/")) {
    const widgetName = req.url.split("/")[2];
    filePath = join(WIDGETS_DIR, widgetName, "index.html");
  }

  // Security: prevent directory traversal
  if (!filePath.startsWith(WIDGETS_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(filePath));
  } catch (err) {
    res.writeHead(500);
    res.end("Internal error");
  }
}

// ── REST API endpoints ─────────────────────────────────────
const REST_HANDLERS = {
  "/api/state": () => ({ ok: true, ...getSnapshot() }),
  "/api/sessions": () => ({ ok: true, sessions: state.sessions }),
  "/api/layouts": () => ({ ok: true, layouts: listLayouts() }),
  "/api/skills": () => ({ ok: true, skills: state.skills }),
  "/api/mcp": () => ({ ok: true, mcpServers: state.mcpServers }),
};

async function handleRest(req, res) {
  const handler = REST_HANDLERS[req.url];
  if (!handler) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const data = await handler();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── WebSocket message handlers ─────────────────────────────
function broadcast(msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(data);
    }
  });
}

function broadcastToWidgets(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client._clientType === "widget") {
      client.send(data);
    }
  });
}

async function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  const { type } = msg;

  switch (type) {
    // ── Client identification ──────────────────────────
    case "identify":
      ws._clientType = msg.clientType || "widget";
      ws._widgetName = msg.widgetName || "unknown";
      console.log(`[ws] ${ws._clientType}:${ws._widgetName} connected`);

      if (ws._clientType === "plugin") {
        state.obsidianPluginConnected = true;
        broadcastToWidgets({ type: "plugin-status", connected: true });
      } else {
        state.connectedWidgets.add(ws._widgetName);
      }

      // Send full state snapshot to the newly connected client
      ws.send(JSON.stringify({
        type: "state-sync",
        ...getSnapshot(),
      }));
      break;

    // ── Session switching ──────────────────────────────
    case "switch-session":
      {
        const sessionName = msg.session;
        const exists = state.sessions.find(s => s.name === sessionName);
        if (!exists) {
          ws.send(JSON.stringify({ type: "error", message: `Session "${sessionName}" not found` }));
          return;
        }
        state.currentSession = sessionName;
        // Update active flag on all sessions
        state.sessions.forEach(s => { s.active = s.name === sessionName; });
        console.log(`[ws] Session switched to: ${sessionName}`);
        broadcast({ type: "session-changed", session: sessionName, sessions: state.sessions });
      }
      break;

    // ── Model switching ────────────────────────────────
    case "switch-model":
      state.currentModel = msg.model || state.currentModel;
      if (msg.thinkingLevel) state.currentThinkingLevel = msg.thinkingLevel;
      console.log(`[ws] Model: ${state.currentModel}, thinking: ${state.currentThinkingLevel}`);
      broadcast({
        type: "model-changed",
        model: state.currentModel,
        thinkingLevel: state.currentThinkingLevel,
      });
      break;

    // ── Open a single widget in a new pane ──────────
    case "open-widget":
      {
        const widgetName = msg.widget;
        console.log(`[ws] Opening widget: ${widgetName}`);
        // Send to companion plugin to open in a new pane
        broadcast({
          type: "open-widget",
          widget: widgetName,
        });
        // Also echo back to widgets so chat can show feedback
        broadcast({
          type: "widget-opened",
          widget: widgetName,
          success: state.obsidianPluginConnected,
        });
      }
      break;

    // ── Skill / MCP copy-to-clipboard ──────────────────
    case "copy-skill":
      {
        const text = getSkillClipboardText(msg.skill);
        if (text) {
          try {
            const { default: clipboard } = await import("clipboardy");
            await clipboard.write(text);
          } catch {}
        }
        broadcast({ type: "skill-copied", skill: msg.skill, text });
      }
      break;

    case "copy-mcp":
      {
        const text = getMcpClipboardText(msg.server);
        if (text) {
          try {
            const { default: clipboard } = await import("clipboardy");
            await clipboard.write(text);
          } catch {}
        }
        broadcast({ type: "mcp-copied", server: msg.server, text });
      }
      break;

    // ── Chat messages (relayed to PI bridge) ───────────
    case "chat-message":
      {
        const sessionName = state.currentSession;
        console.log(`[chat] Message in ${sessionName}: ${msg.message?.slice(0, 80)}...`);
        broadcastToWidgets({
          type: "chat-echo",
          message: msg.message,
          session: sessionName,
          timestamp: new Date().toISOString(),
        });

        // TODO: Full PI SDK integration for actual agent responses
        // For now, acknowledge receipt
        ws.send(JSON.stringify({
          type: "chat-status",
          status: "received",
          message: "Message queued. PI SDK integration coming soon.",
        }));
      }
      break;

    // ── Request session history ────────────────────────
    case "get-history":
      {
        const history = readSessionHistory(msg.session || state.currentSession, msg.limit || 50);
        ws.send(JSON.stringify({
          type: "session-history",
          session: msg.session || state.currentSession,
          entries: history,
        }));
      }
      break;

    // ── Request skills/MCP refresh ─────────────────────
    case "refresh-skills":
      scanSkills();
      scanMcpServers();
      broadcast({ type: "skills-updated", skills: state.skills, mcpServers: state.mcpServers });
      break;

    // ── Unknown ────────────────────────────────────────
    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${type}` }));
  }
}

// ── Create HTTP + WS server ────────────────────────────────
const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/")) {
    handleRest(req, res);
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  } else {
    serveStatic(req, res);
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws._clientType = "unknown";
  ws._widgetName = "unknown";

  ws.on("message", (raw) => handleMessage(ws, raw));

  ws.on("close", () => {
    if (ws._clientType === "plugin") {
      state.obsidianPluginConnected = false;
      broadcastToWidgets({ type: "plugin-status", connected: false });
    } else if (ws._clientType === "widget") {
      state.connectedWidgets.delete(ws._widgetName);
    }
    console.log(`[ws] ${ws._clientType}:${ws._widgetName} disconnected`);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error (${ws._widgetName}):`, err.message);
  });
});

// ── File watcher: PI sessions ──────────────────────────────
const watcher = chokidar.watch(
  [homedir() + "/.pi/agent/sessions"],
  {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 2,
    ignoreInitial: true,
  }
);

watcher.on("all", (event, filePath) => {
  if (event === "add" || event === "change" || event === "unlink") {
    scanSessions();
    broadcastToWidgets({
      type: "sessions-updated",
      sessions: state.sessions,
      trigger: event,
    });
  }
});

// ── Startup ─────────────────────────────────────────────────
console.log("┌─────────────────────────────────────┐");
console.log("│        PI Cockpit Hub               │");
console.log("├─────────────────────────────────────┤");

// Initial scans
scanSessions();
scanSkills();
scanMcpServers();

console.log(`│ Sessions: ${state.sessions.length} found`);
console.log(`│ Skills:   ${state.skills.length} found`);
console.log(`│ MCP:      ${state.mcpServers.length} found`);
console.log(`│ Default session: ${state.currentSession || "none"}`);
console.log("├─────────────────────────────────────┤");

server.listen(PORT, () => {
  console.log(`│ HTTP:  http://localhost:${PORT}`);
  console.log(`│ WS:    ws://localhost:${PORT}`);
  console.log("├─────────────────────────────────────┤");
  console.log("│ Widgets:");
  console.log(`│   http://localhost:${PORT}/widget/session-switcher`);
  console.log(`│   http://localhost:${PORT}/widget/vault-chat`);
  console.log(`│   http://localhost:${PORT}/widget/skills-directory`);
  console.log(`│   http://localhost:${PORT}/widget/model-switcher`);
  console.log("└─────────────────────────────────────┘");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await watcher.close();
  wss.close();
  server.close();
  process.exit(0);
});
