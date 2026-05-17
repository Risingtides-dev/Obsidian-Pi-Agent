/**
 * PI Cockpit — WebSocket Hub
 *
 * Central server that:
 *   - Serves widget HTML/JS/CSS as static files
 *   - Manages WebSocket connections from widgets and companion plugin
 *   - Broadcasts state changes
 *   - Monitors PI sessions, skills, and daemons on disk
 *   - Bridges chat messages through PI SDK
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
import { scanDaemons, readHeartbeat, restartDaemon, readDaemonLog } from "./daemon-monitor.js";
import { listRoutines, getRoutine, saveRoutine, deleteRoutine, toggleRoutine, runRoutineNow, readRoutineLog } from "./routines-monitor.js";
import {
  bootstrap as bootstrapTickets,
  listTickets,
  getTicket,
  saveTicket,
  deleteTicket,
  transitionTicket,
  listComments,
  addComment,
  deleteComment,
  getHistory,
  getMeta as getTicketsMeta,
  saveMeta as saveTicketsMeta,
  getSnapshot as getTicketsSnapshot,
  TICKETS_PATH,
} from "./tickets-monitor.js";
import { getLayout, listLayouts, LAYOUTS } from "./layouts.js";
import { PiBridge } from "./pi-bridge.js";
import { handleTmaRoutes } from "./tma-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3099;
const WIDGETS_DIR = join(__dirname, "..", "widgets");

// ── PI Bridge (SDK integration) ────────────────────────────
const piBridge = new PiBridge();

piBridge.setEventCallback((event) => {
  broadcast({ type: "agent-event", event });

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
// Serves the landing page and any widget HTML that still exists on disk
// (e.g. cron-dashboard). Native Obsidian widgets (sessions/chat/skills/model)
// are rendered directly by the companion plugin and don't need HTML files.
function serveStatic(req, res) {
  let filePath = join(WIDGETS_DIR, req.url === "/" ? "index.html" : req.url);

  if (req.url.startsWith("/widget/")) {
    const widgetName = req.url.split("/")[2];
    filePath = join(WIDGETS_DIR, widgetName, "index.html");
  }

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
  "/api/state": () => ({
    ok: true,
    ...getSnapshot(),
    currentModel: piBridge.getCurrentModel()?.id || state.currentModel,
  }),
  "/api/sessions": () => ({ ok: true, sessions: state.sessions }),
  "/api/layouts": () => ({ ok: true, layouts: listLayouts() }),
  "/api/skills": () => ({ ok: true, skills: state.skills }),
  "/api/mcp": () => ({ ok: true, mcpServers: state.mcpServers }),
  "/api/models": () => ({ ok: true, models: piBridge.getAvailableModels() }),
  "/api/daemons": () => ({
    ok: true,
    daemons: scanDaemons(),
    heartbeat: readHeartbeat(),
  }),
  "/api/routines": () => ({ ok: true, routines: listRoutines() }),
  "/api/tickets": () => ({ ok: true, ...getTicketsSnapshot() }),
  "/api/tickets/meta": () => ({ ok: true, meta: getTicketsMeta() }),
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

function broadcastToUi(msg) {
  // UI broadcast channel contract: delivers filesystem-driven updates to every
  // client that renders PI Cockpit state visually — both static web widgets
  // (clientType "widget") and the native Obsidian companion plugin (clientType
  // "plugin", which owns the ItemView panes).  The invariant is that any state
  // change originating on disk (file watcher) or from a UI action MUST reach
  // all connected UI surfaces so they stay in sync without manual refresh.
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && (client._clientType === "widget" || client._clientType === "plugin")) {
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
    case "identify":
      ws._clientType = msg.clientType || "widget";
      ws._widgetName = msg.widgetName || "unknown";
      console.log(`[ws] ${ws._clientType}:${ws._widgetName} connected`);

      if (ws._clientType === "plugin") {
        state.obsidianPluginConnected = true;
        broadcastToUi({ type: "plugin-status", connected: true });
      } else {
        state.connectedWidgets.add(ws._widgetName);
      }

      ws.send(JSON.stringify({
        type: "state-sync",
        ...getSnapshot(),
        models: piBridge.getAvailableModels(),
        currentModel: piBridge.getCurrentModel()?.id || state.currentModel,
        currentThinkingLevel: piBridge.getCurrentThinking() || state.currentThinkingLevel,
        isStreaming: piBridge.isStreaming,
        theme: state.theme || null,
      }));
      break;

    case "switch-session":
      {
        const sessionName = msg.session;
        const exists = state.sessions.find(s => s.name === sessionName);
        if (!exists) {
          ws.send(JSON.stringify({ type: "error", message: `Session "${sessionName}" not found` }));
          return;
        }

        const chosenFile = msg.file || exists.lastFile;
        const jsonlFile = chosenFile
          ? join(homedir(), ".pi", "agent", "sessions", sessionName, chosenFile)
          : null;
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

    case "switch-model":
      {
        const modelId = msg.model;
        const thinkingLevel = msg.thinkingLevel;

        if (modelId) {
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

    case "open-widget":
      {
        const widgetName = msg.widget;
        console.log(`[ws] Opening widget: ${widgetName}`);
        broadcast({ type: "open-widget", widget: widgetName });
        broadcast({
          type: "widget-opened",
          widget: widgetName,
          success: state.obsidianPluginConnected,
        });
      }
      break;

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
          scanSessions();
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

    case "abort":
      try {
        await piBridge.abort();
        ws.send(JSON.stringify({ type: "abort-ack", success: true }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      break;

    case "chat-message":
      {
        const text = msg.message;
        if (!text) break;

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

        broadcast({
          type: "user-message",
          message: text,
          origin: origin,
          timestamp: new Date().toISOString(),
        }, ws);

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

    case "get-history":
      {
        const sessionName = msg.session || state.currentSession;
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

    case "refresh-skills":
      scanSkills();
      scanMcpServers();
      broadcast({ type: "skills-updated", skills: state.skills, mcpServers: state.mcpServers });
      break;

    case "theme-update":
      state.theme = { vars: msg.vars, isDark: msg.isDark, ts: Date.now() };
      broadcastToUi({
        type: "theme-update",
        vars: msg.vars,
        isDark: msg.isDark,
      });
      break;

    case "refresh-daemons":
    case "daemons-refresh":
      {
        const daemons = scanDaemons();
        const heartbeat = readHeartbeat();
        ws.send(JSON.stringify({ type: "daemons-updated", daemons, heartbeat }));
        broadcastToUi({ type: "daemons-updated", daemons, heartbeat });
      }
      break;

    case "restart-daemon":
      {
        const label = msg.label || msg.daemon;
        if (!label) {
          ws.send(JSON.stringify({ type: "error", message: "Missing daemon label" }));
          return;
        }
        console.log(`[ws] Restarting daemon: ${label}`);
        const result = restartDaemon(label);
        ws.send(JSON.stringify({ type: "daemon-restarted", label, ...result }));
        setTimeout(() => {
          const daemons = scanDaemons();
          const heartbeat = readHeartbeat();
          broadcastToUi({ type: "daemons-updated", daemons, heartbeat });
        }, 1500);
      }
      break;

    case "view-daemon-log":
      {
        const label = msg.label || msg.daemon;
        const lines = msg.lines || 50;
        if (!label) {
          ws.send(JSON.stringify({ type: "error", message: "Missing daemon label" }));
          return;
        }
        const result = readDaemonLog(label, lines);
        ws.send(JSON.stringify({ type: "daemon-log", label, ...result }));
      }
      break;

    // ── Routines (user-defined recurring tasks) ─────
    case "refresh-routines":
      ws.send(JSON.stringify({ type: "routines-updated", routines: listRoutines() }));
      break;

    case "get-routine":
      {
        const r = getRoutine(msg.slug);
        ws.send(JSON.stringify({ type: "routine-detail", slug: msg.slug, routine: r }));
      }
      break;

    case "save-routine":
      try {
        const saved = saveRoutine(msg.routine || {});
        broadcastToUi({ type: "routines-updated", routines: listRoutines() });
        ws.send(JSON.stringify({ type: "routine-saved", routine: saved }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `save-routine: ${err.message}` }));
      }
      break;

    case "delete-routine":
      try {
        deleteRoutine(msg.slug);
        broadcastToUi({ type: "routines-updated", routines: listRoutines() });
        ws.send(JSON.stringify({ type: "routine-deleted", slug: msg.slug }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `delete-routine: ${err.message}` }));
      }
      break;

    case "toggle-routine":
      try {
        const r = toggleRoutine(msg.slug, msg.enabled);
        broadcastToUi({ type: "routines-updated", routines: listRoutines() });
        ws.send(JSON.stringify({ type: "routine-toggled", slug: msg.slug, ...r }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `toggle-routine: ${err.message}` }));
      }
      break;

    case "run-routine":
      {
        const result = runRoutineNow(msg.slug);
        ws.send(JSON.stringify({ type: "routine-ran", slug: msg.slug, ...result }));
      }
      break;

    case "view-routine-log":
      {
        const lines = msg.lines || 50;
        const result = readRoutineLog(msg.slug, lines);
        ws.send(JSON.stringify({ type: "routine-log", slug: msg.slug, ...result }));
      }
      break;

    // ── Tickets ─────────────────────────────────────────────
    case "tickets-refresh":
      ws.send(JSON.stringify({ type: "tickets-snapshot", ...getTicketsSnapshot() }));
      break;

    case "ticket-get":
      {
        const t = getTicket(msg.identifier);
        const comments = t ? listComments(msg.identifier) : [];
        const history = t ? getHistory(msg.identifier) : [];
        ws.send(JSON.stringify({ type: "ticket-detail", identifier: msg.identifier, ticket: t, comments, history }));
      }
      break;

    case "ticket-save":
      try {
        const saved = saveTicket(msg.ticket || {});
        broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
        ws.send(JSON.stringify({ type: "ticket-saved", ticket: saved }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `ticket-save: ${err.message}` }));
      }
      break;

    case "ticket-delete":
      try {
        deleteTicket(msg.identifier);
        broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
        ws.send(JSON.stringify({ type: "ticket-deleted", identifier: msg.identifier }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `ticket-delete: ${err.message}` }));
      }
      break;

    case "ticket-transition":
      try {
        const updated = transitionTicket(msg.identifier, msg.state, msg.actor || "user");
        broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
        ws.send(JSON.stringify({ type: "ticket-saved", ticket: updated }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `ticket-transition: ${err.message}` }));
      }
      break;

    case "ticket-comment-add":
      try {
        const c = addComment(msg.identifier, { body: msg.body, author: msg.author, parent: msg.parent });
        const comments = listComments(msg.identifier);
        ws.send(JSON.stringify({ type: "ticket-comments", identifier: msg.identifier, comments, added: c }));
        broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `ticket-comment-add: ${err.message}` }));
      }
      break;

    case "ticket-comment-delete":
      try {
        deleteComment(msg.identifier, msg.commentId);
        const comments = listComments(msg.identifier);
        ws.send(JSON.stringify({ type: "ticket-comments", identifier: msg.identifier, comments }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `ticket-comment-delete: ${err.message}` }));
      }
      break;

    case "tickets-meta-save":
      try {
        const meta = saveTicketsMeta(msg.meta || {});
        broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
        ws.send(JSON.stringify({ type: "tickets-meta-saved", meta }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `tickets-meta-save: ${err.message}` }));
      }
      break;

    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${type}` }));
  }
}

// ── Create HTTP + WS server ────────────────────────────────
const server = createServer((req, res) => {
  const host = (req.headers.host || "").toLowerCase();

  if (host.startsWith("{{AGENT_NAME_LOWER}}.{{DOMAIN}}")) {
    handleTmaRoutes(req, res);
    return;
  }

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
      broadcastToUi({ type: "plugin-status", connected: false });
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
    ignored: /(^|[/\\])\../,
    persistent: true,
    depth: 2,
    ignoreInitial: true,
  }
);

watcher.on("all", (event, filePath) => {
  if (event === "add" || event === "change" || event === "unlink") {
    scanSessions();
    broadcastToUi({
      type: "sessions-updated",
      sessions: state.sessions,
      trigger: event,
    });
  }
});

// ── Heartbeat file watcher ─────────────────────────────────
const HEARTBEAT_PATH = "{{VAULT_PATH}}/heartbeat.md";
const heartbeatWatcher = chokidar.watch(HEARTBEAT_PATH, {
  persistent: true,
  ignoreInitial: true,
});

heartbeatWatcher.on("change", () => {
  const daemons = scanDaemons();
  const heartbeat = readHeartbeat();
  broadcastToUi({ type: "daemons-updated", daemons, heartbeat });
});

// ── Tickets file watcher ───────────────────────────────────
bootstrapTickets();
const ticketsWatcher = chokidar.watch(TICKETS_PATH, {
  ignored: /(^|[/\\])\.meta($|[/\\])|history\.jsonl$/,
  persistent: true,
  depth: 3,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
});

let ticketsBroadcastTimer = null;
ticketsWatcher.on("all", (event) => {
  if (event !== "add" && event !== "change" && event !== "unlink") return;
  clearTimeout(ticketsBroadcastTimer);
  ticketsBroadcastTimer = setTimeout(() => {
    broadcastToUi({ type: "tickets-snapshot", ...getTicketsSnapshot() });
  }, 150);
});

// ── Startup ─────────────────────────────────────────────────
console.log("┌─────────────────────────────────────┐");
console.log("│        PI Cockpit Hub               │");
console.log("├─────────────────────────────────────┤");

scanSessions();
scanSkills();
scanMcpServers();

const availableModels = piBridge.getAvailableModels();
const daemons = scanDaemons();
const heartbeat = readHeartbeat();

console.log(`│ Sessions:  ${state.sessions.length} found`);
console.log(`│ Skills:    ${state.skills.length} found`);
console.log(`│ MCP:       ${state.mcpServers.length} found`);
console.log(`│ Models:    ${availableModels.length} available`);
console.log(`│ Daemons:   ${daemons.filter(d => d.running).length}/${daemons.length} running`);
console.log(`│ Heartbeat: ${heartbeat?.overallStatus || "no data"}`);
const ticketsCount = listTickets().length;
console.log(`│ Tickets:   ${ticketsCount} in ${TICKETS_PATH.replace(homedir(), "~")}`);
console.log(`│ Default session: ${state.currentSession || "none"}`);
console.log("├─────────────────────────────────────┤");

server.listen(PORT, () => {
  console.log(`│ HTTP:  http://localhost:${PORT}`);
  console.log(`│ WS:    ws://localhost:${PORT}`);
  console.log("├─────────────────────────────────────┤");
  console.log("│ Native widgets render in Obsidian");
  console.log("│ via the companion plugin.");
  console.log("│ Cron Dashboard widget at:");
  console.log(`│   http://localhost:${PORT}/widget/cron-dashboard`);
  console.log("└─────────────────────────────────────┘");
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await watcher.close();
  await heartbeatWatcher.close();
  await piBridge.dispose();
  wss.close();
  server.close();
  process.exit(0);
});
