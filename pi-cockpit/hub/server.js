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
import { scanSessions, readSessionHistory, getSessionPath } from "./session-monitor.js";
import { scanSkills, scanMcpServers, getSkillClipboardText, getMcpClipboardText } from "./skills-monitor.js";
import { getLayout, listLayouts, LAYOUTS } from "./layouts.js";
import { PiBridge } from "./pi-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3099;
const WIDGETS_DIR = join(__dirname, "..", "widgets");

// ── PI Bridge (SDK integration) ────────────────────────────
const piBridge = new PiBridge();

// Forward all agent events as hub broadcasts
piBridge.setEventCallback((event) => {
  // Forward raw agent events to all connected clients
  // Clients filter by event.type to handle what they care about
  broadcast({ type: "agent-event", event });

  // Also update state for specific events
  if (event.type === "agent_start") {
    broadcast({ type: "agent-status", streaming: true });
  } else if (event.type === "agent_end") {
    broadcast({ type: "agent-status", streaming: false });
  } else if (event.type === "thinking_level_changed") {
    state.currentThinkingLevel = event.level;
    broadcast({ type: "model-changed", model: state.currentModel, thinkingLevel: event.level });
  }
});

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
// Serves the hub status page (index.html) and shared assets from pi-cockpit/widgets/.
// Individual widget HTMLs were removed — widgets now render natively in Obsidian
// via the companion plugin. /widget/<name> URLs return 404 by design.
function serveStatic(req, res) {
  let filePath = join(WIDGETS_DIR, req.url === "/" ? "index.html" : req.url);

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
  "/api/state": () => ({ ok: true, ...getSnapshot(), currentModel: piBridge.getCurrentModel()?.id || state.currentModel }),
  "/api/sessions": () => ({ ok: true, sessions: state.sessions }),
  "/api/layouts": () => ({ ok: true, layouts: listLayouts() }),
  "/api/skills": () => ({ ok: true, skills: state.skills }),
  "/api/mcp": () => ({ ok: true, mcpServers: state.mcpServers }),
  "/api/models": () => ({ ok: true, models: piBridge.getAvailableModels() }),
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
        // Include dynamic data from PI bridge
        models: piBridge.getAvailableModels(),
        currentModel: piBridge.getCurrentModel()?.id || state.currentModel,
        currentThinkingLevel: piBridge.getCurrentThinking() || state.currentThinkingLevel,
        isStreaming: piBridge.isStreaming,
        // Include latest theme if we have it
        theme: state.theme || null,
      }));
      break;

    // ── Session switching ──────────────────────────────
    // Accepts either:
    //   { session: "<projectDirName>" }                 → resume project's most-recent JSONL
    //   { session: "<projectDirName>", file: "<jsonl>" } → resume that specific JSONL
    case "switch-session":
      {
        const sessionName = msg.session;
        const exists = state.sessions.find(s => s.name === sessionName);
        if (!exists) {
          ws.send(JSON.stringify({ type: "error", message: `Session "${sessionName}" not found` }));
          return;
        }

        // Pick the JSONL file: explicit override, else newest in project.
        const chosenFile = msg.file || exists.lastFile;
        const jsonlFile = chosenFile
          ? join(homedir(), ".pi", "agent", "sessions", sessionName, chosenFile)
          : null;

        // Resolve the working directory the PI agent should run in.
        // For worktrees this is e.g. ~/.worktrees/Thoth-pi-cockpit;
        // for regular projects it's ~/dev/Thoth, etc.
        // If we can't resolve it, fall back to homedir() so PI doesn't run from the hub dir.
        const projectCwd = exists.cwd || homedir();

        console.log(`[ws] Switching session: ${sessionName} → ${chosenFile || "(new)"}  cwd=${projectCwd}`);

        try {
          if (jsonlFile) {
            await piBridge.switchSession(jsonlFile, projectCwd);
          } else {
            await piBridge.startSession(undefined, projectCwd);
          }
          state.currentSession = sessionName;
          state.currentSessionFile = chosenFile || null;
          state.sessions.forEach(s => { s.active = s.name === sessionName; });
          broadcast({
            type: "session-changed",
            session: sessionName,
            file: chosenFile || null,
            cwd: projectCwd,
            sessions: state.sessions,
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: `Session switch failed: ${err.message}` }));
        }
      }
      break;

    // ── Model switching ────────────────────────────────
    case "switch-model":
      {
        const modelId = msg.model;
        const thinkingLevel = msg.thinkingLevel;

        if (modelId) {
          // modelId is "provider/modelId" format from the available models list
          const [provider, ...rest] = modelId.split("/");
          const bareId = rest.join("/");
          try {
            await piBridge.setModel(provider, bareId);
            state.currentModel = modelId;
          } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Model switch failed: ${err.message}` }));
            break;
          }
        }

        if (thinkingLevel) {
          piBridge.setThinking(thinkingLevel);
          state.currentThinkingLevel = thinkingLevel;
        }

        console.log(`[ws] Model: ${state.currentModel}, thinking: ${state.currentThinkingLevel}`);
        broadcast({
          type: "model-changed",
          model: state.currentModel,
          thinkingLevel: state.currentThinkingLevel,
        });
      }
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

    // ── New session (start fresh, don't resume) ───────
    case "new-session":
      {
        const sessionName = msg.session || state.currentSession;
        const sessionRecord = sessionName
          ? state.sessions.find(s => s.name === sessionName)
          : null;
        const projectCwd = sessionRecord?.cwd || homedir();

        console.log(`[ws] New session in: ${projectCwd}`);
        try {
          await piBridge.startSession(undefined, projectCwd);
          // Re-scan so the new JSONL appears immediately.
          scanSessions();
          // The new session will be the most-recent file; update state.
          const updated = state.sessions.find(s => s.name === sessionName);
          if (sessionName) {
            state.currentSession = sessionName;
            state.currentSessionFile = updated?.lastFile || null;
            state.sessions.forEach(s => { s.active = s.name === sessionName; });
          }
          broadcast({
            type: "session-changed",
            session: state.currentSession,
            file: state.currentSessionFile,
            cwd: projectCwd,
            sessions: state.sessions,
            isNew: true,
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: `New session failed: ${err.message}` }));
        }
      }
      break;

    // ── Telegram bridge connect / disconnect ──────────
    case "telegram-connect":
      {
        const sessionName = msg.session || state.currentSession;
        state.telegramSession = sessionName;
        console.log(`[ws] Telegram connected to session: ${sessionName}`);
        broadcast({ type: "telegram-changed", telegramSession: sessionName });
      }
      break;

    case "telegram-disconnect":
      state.telegramSession = null;
      console.log("[ws] Telegram disconnected");
      broadcast({ type: "telegram-changed", telegramSession: null });
      break;

    // ── Abort current agent operation ─────────────────
    case "abort":
      try {
        await piBridge.abort();
        ws.send(JSON.stringify({ type: "abort-ack", success: true }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      break;

    // ── Chat messages (relayed to PI SDK) ────────────
    case "chat-message":
      {
        const text = msg.message;
        if (!text) break;

        // Tag message with origin so the PI session knows where it came from
        let origin = "unknown";
        let taggedText = text;
        if (ws._clientType === "plugin") {
          origin = "vault chat";
          taggedText = `[vault chat] ${text}`;
        } else if (ws._clientType === "telegram") {
          origin = "telegram";
          taggedText = `[telegram] ${text}`;
        }

        console.log(`[chat] ${origin}: ${text.slice(0, 80)}...`);

        // Echo user message to all OTHER clients so they can display it
        broadcast({
          type: "user-message",
          message: text,
          origin: origin,
          timestamp: new Date().toISOString(),
        }, ws);  // exclude sender

        // Auto-start a session if none is active.
        // Prefer the currently-selected session's cwd; fall back to homedir().
        if (!piBridge.session) {
          const selected = state.currentSession
            ? state.sessions.find(s => s.name === state.currentSession)
            : null;
          const autoCwd = selected?.cwd || homedir();
          ws.send(JSON.stringify({
            type: "chat-status",
            status: "starting",
            message: `Starting session in ${autoCwd}...`,
          }));
          try {
            await piBridge.startSession(undefined, autoCwd);
          } catch (err) {
            ws.send(JSON.stringify({
              type: "chat-status",
              status: "error",
              message: `Failed to start session: ${err.message}`,
            }));
            break;
          }
        }

        // Send tagged message to PI
        try {
          ws.send(JSON.stringify({
            type: "chat-status",
            status: "received",
            message: "Processing...",
          }));
          await piBridge.sendMessage(taggedText);
        } catch (err) {
          ws.send(JSON.stringify({
            type: "chat-status",
            status: "error",
            message: err.message,
          }));
        }
      }
      break;

    // ── Request session history ────────────────────────
    case "get-history":
      {
        const sessionName = msg.session || state.currentSession;
        // Prefer explicit file; else fall back to the session's tracked currentSessionFile.
        const file = msg.file
          || (sessionName === state.currentSession ? state.currentSessionFile : null)
          || null;
        const history = readSessionHistory(sessionName, msg.limit || 200, file);
        ws.send(JSON.stringify({
          type: "session-history",
          session: sessionName,
          file,
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

    // ── Theme update from Obsidian plugin ─────────────
    case "theme-update":
      state.theme = { vars: msg.vars, isDark: msg.isDark, ts: Date.now() };
      broadcastToWidgets({
        type: "theme-update",
        vars: msg.vars,
        isDark: msg.isDark,
      });
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

// PI Bridge: load available models
const availableModels = piBridge.getAvailableModels();

console.log(`│ Sessions: ${state.sessions.length} found`);
console.log(`│ Skills:   ${state.skills.length} found`);
console.log(`│ MCP:      ${state.mcpServers.length} found`);
console.log(`│ Models:   ${availableModels.length} available`);
console.log(`│ Default session: ${state.currentSession || "none"}`);
console.log("├─────────────────────────────────────┤");

server.listen(PORT, () => {
  console.log(`│ HTTP:  http://localhost:${PORT}`);
  console.log(`│ WS:    ws://localhost:${PORT}`);
  console.log("├─────────────────────────────────────┤");
  console.log("│ Widgets render natively in Obsidian");
  console.log("│ (companion plugin: pi-cockpit)");
  console.log("└─────────────────────────────────────┘");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await watcher.close();
  await piBridge.dispose();
  wss.close();
  server.close();
  process.exit(0);
});
