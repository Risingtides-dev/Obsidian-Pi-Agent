/**
 * Tickets Monitor — Vault-native issue tracker, Linear-shaped.
 *
 * Storage: <VAULT>/6-Agent/tickets/<TEAM>-<N>.md
 *   YAML frontmatter holds structured fields. Markdown body is the description.
 *   Markdown is the source of truth. SQLite index is a cache.
 *
 * Schema is minimum-viable-Linear:
 *   workspace ─ team ─ workflow_state ─ label ─ user ─ project ─ cycle
 *                       │
 *                     issue ── issue_label (m2m)
 *                       │
 *                     issue_relation, comment, attachment, issue_history
 *
 * Watcher uses chokidar like routines-monitor. Broadcasts CRUD events
 * over WebSocket so the widget stays live.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const VAULT_PATH = process.env.VAULT_PATH || path.join(HOME, "dev", "{{AGENT_NAME}}");
const TICKETS_DIR = path.join(VAULT_PATH, "6-Agent", "tickets");
const META_DIR = path.join(TICKETS_DIR, ".meta");
const COUNTER_FILE = path.join(META_DIR, "counters.json");
const META_FILE = path.join(META_DIR, "workspace.json");

const DEFAULT_TEAM_KEY = "THO";

const DEFAULT_STATES = [
  { id: "triage", name: "Triage", color: "#94a3b8", type: "triage", position: 0 },
  { id: "backlog", name: "Backlog", color: "#6c7086", type: "backlog", position: 1 },
  { id: "todo", name: "Todo", color: "#a6adc8", type: "unstarted", position: 2 },
  { id: "in_progress", name: "In Progress", color: "#89b4fa", type: "started", position: 3 },
  { id: "review", name: "In Review", color: "#f9e2af", type: "started", position: 4 },
  { id: "done", name: "Done", color: "#a6e3a1", type: "completed", position: 5 },
  { id: "canceled", name: "Canceled", color: "#f38ba8", type: "canceled", position: 6 },
];

const DEFAULT_LABELS = [
  { id: "security", name: "security", color: "#f38ba8" },
  { id: "bug", name: "bug", color: "#fab387" },
  { id: "feature", name: "feature", color: "#89b4fa" },
  { id: "refactor", name: "refactor", color: "#cba6f7" },
  { id: "infra", name: "infra", color: "#94e2d5" },
  { id: "docs", name: "docs", color: "#a6e3a1" },
];

const PRIORITY_LABELS = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

// ── Filesystem helpers ────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureScaffold() {
  ensureDir(TICKETS_DIR);
  ensureDir(META_DIR);
  if (!fs.existsSync(COUNTER_FILE)) {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ [DEFAULT_TEAM_KEY]: 0 }, null, 2));
  }
  if (!fs.existsSync(META_FILE)) {
    fs.writeFileSync(META_FILE, JSON.stringify({
      workspace: { id: "{{AGENT_NAME_LOWER}}", name: "{{AGENT_NAME}}", key: DEFAULT_TEAM_KEY },
      teams: [{ id: DEFAULT_TEAM_KEY.toLowerCase(), key: DEFAULT_TEAM_KEY, name: "{{AGENT_NAME}}" }],
      states: DEFAULT_STATES,
      labels: DEFAULT_LABELS,
      users: [
        { id: "john", name: "john", type: "human", avatar: "👤" },
        { id: "agent:sage", name: "Sage", type: "agent", avatar: "🧙" },
        { id: "agent:flux", name: "Flux", type: "agent", avatar: "⚡" },
        { id: "agent:knox", name: "Knox", type: "agent", avatar: "🛡" },
        { id: "agent:scout", name: "Scout", type: "agent", avatar: "🔭" },
      ],
      projects: [],
      cycles: [],
    }, null, 2));
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Tiny YAML frontmatter parser ──────────────────────────────────
// Handles: strings, numbers, booleans, null, ISO dates, arrays of scalars.

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const yaml = match[1];
  const body = match[2] || "";
  const data = {};
  let currentArrayKey = null;
  const lines = yaml.split("\n");
  for (const line of lines) {
    if (!line.trim()) {
      currentArrayKey = null;
      continue;
    }
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentArrayKey) {
      data[currentArrayKey].push(coerce(itemMatch[1].trim()));
      continue;
    }
    const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    const val = rawVal.trim();
    if (val === "") {
      data[key] = [];
      currentArrayKey = key;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val.slice(1, -1).split(",").map(s => coerce(s.trim())).filter(v => v !== "");
      currentArrayKey = null;
    } else {
      data[key] = coerce(val);
      currentArrayKey = null;
    }
  }
  return { data, body: body.trim() };
}

function coerce(s) {
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeFrontmatter(data, body) {
  const lines = ["---"];
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      lines.push(`${key}: null`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}: [${val.map(formatScalar).join(", ")}]`);
      }
    } else if (typeof val === "string" && (val.includes(":") || val.includes("#") || val.includes("["))) {
      lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n") + (body || "");
}

function formatScalar(v) {
  if (v === null) return "null";
  if (typeof v === "string" && (v.includes(",") || v.includes(":"))) return `"${v}"`;
  return String(v);
}

// ── Identifier generation ─────────────────────────────────────────

function nextIdentifier(teamKey = DEFAULT_TEAM_KEY) {
  ensureScaffold();
  const counters = readJSON(COUNTER_FILE, {});
  counters[teamKey] = (counters[teamKey] || 0) + 1;
  writeJSON(COUNTER_FILE, counters);
  return `${teamKey}-${counters[teamKey]}`;
}

// ── Metadata accessors ────────────────────────────────────────────

export function getMeta() {
  ensureScaffold();
  return readJSON(META_FILE, {});
}

export function saveMeta(meta) {
  ensureScaffold();
  writeJSON(META_FILE, meta);
  return meta;
}

// ── Ticket CRUD ───────────────────────────────────────────────────

export function listTickets() {
  ensureScaffold();
  if (!fs.existsSync(TICKETS_DIR)) return [];
  const files = fs.readdirSync(TICKETS_DIR).filter(f => f.endsWith(".md") && !f.startsWith("."));
  return files.map(f => readTicketFile(path.join(TICKETS_DIR, f))).filter(Boolean);
}

export function getTicket(identifier) {
  if (!identifier) return null;
  const filePath = path.join(TICKETS_DIR, `${identifier}.md`);
  if (!fs.existsSync(filePath)) return null;
  return readTicketFile(filePath);
}

function readTicketFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, body } = parseFrontmatter(raw);
    if (!data.identifier) return null;
    return {
      ...data,
      description: body,
      _file: filePath,
    };
  } catch (err) {
    console.error(`[tickets] failed to read ${filePath}:`, err.message);
    return null;
  }
}

export function saveTicket(input) {
  ensureScaffold();
  const now = new Date().toISOString();
  const isNew = !input.identifier;
  const identifier = input.identifier || nextIdentifier(input.team || DEFAULT_TEAM_KEY);

  const existing = isNew ? null : getTicket(identifier);
  const baseData = existing
    ? Object.fromEntries(Object.entries(existing).filter(([k]) => !k.startsWith("_") && k !== "description"))
    : {};

  const merged = {
    ...baseData,
    ...input,
    identifier,
    id: identifier,
    title: input.title || existing?.title || "Untitled",
    state: input.state || existing?.state || "todo",
    priority: input.priority ?? existing?.priority ?? 0,
    assignee: input.assignee ?? existing?.assignee ?? null,
    labels: input.labels ?? existing?.labels ?? [],
    parent: input.parent ?? existing?.parent ?? null,
    project: input.project ?? existing?.project ?? null,
    cycle: input.cycle ?? existing?.cycle ?? null,
    estimate: input.estimate ?? existing?.estimate ?? null,
    due_date: input.due_date ?? existing?.due_date ?? null,
    created_at: existing?.created_at || now,
    updated_at: now,
    started_at: input.started_at ?? existing?.started_at ?? null,
    completed_at: input.completed_at ?? existing?.completed_at ?? null,
  };

  const body = input.description ?? existing?.description ?? "";
  const description = body.startsWith("# ") ? body : `# ${merged.title}\n\n${body}`.trim();

  // Auto-set started_at / completed_at on state transitions
  const meta = getMeta();
  const state = meta.states?.find(s => s.id === merged.state);
  if (state?.type === "started" && !merged.started_at) merged.started_at = now;
  if (state?.type === "completed" && !merged.completed_at) merged.completed_at = now;
  if (state?.type !== "completed" && state?.type !== "canceled") merged.completed_at = null;

  const out = serializeFrontmatter(stripInternals(merged), description);
  const filePath = path.join(TICKETS_DIR, `${identifier}.md`);
  fs.writeFileSync(filePath, out);

  if (isNew) {
    appendHistory(identifier, { actor: "system", field: "created", from: null, to: identifier, at: now });
  }
  return getTicket(identifier);
}

function stripInternals(data) {
  const { _file, description, ...rest } = data;
  return rest;
}

export function deleteTicket(identifier) {
  const filePath = path.join(TICKETS_DIR, `${identifier}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const commentsDir = path.join(TICKETS_DIR, identifier);
  if (fs.existsSync(commentsDir)) {
    fs.rmSync(commentsDir, { recursive: true, force: true });
  }
  return { ok: true };
}

export function transitionTicket(identifier, newState, actor = "user") {
  const t = getTicket(identifier);
  if (!t) throw new Error(`Ticket not found: ${identifier}`);
  const from = t.state;
  const updated = saveTicket({ ...t, state: newState });
  appendHistory(identifier, {
    actor,
    field: "state",
    from,
    to: newState,
    at: new Date().toISOString(),
  });
  return updated;
}

// ── Comments ──────────────────────────────────────────────────────

export function listComments(identifier) {
  const dir = path.join(TICKETS_DIR, identifier, "comments");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const { data, body } = parseFrontmatter(raw);
      return { ...data, body, _file: path.join(dir, f) };
    })
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

export function addComment(identifier, { body, author = "john", parent = null }) {
  const dir = path.join(TICKETS_DIR, identifier, "comments");
  ensureDir(dir);
  const now = new Date().toISOString();
  const id = `c-${Date.now()}`;
  const filePath = path.join(dir, `${id}.md`);
  const out = serializeFrontmatter({
    id,
    issue: identifier,
    author,
    parent,
    created_at: now,
  }, body || "");
  fs.writeFileSync(filePath, out);
  appendHistory(identifier, { actor: author, field: "comment", from: null, to: id, at: now });
  return { id, issue: identifier, author, parent, created_at: now, body };
}

export function deleteComment(identifier, commentId) {
  const filePath = path.join(TICKETS_DIR, identifier, "comments", `${commentId}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return { ok: true };
}

// ── Activity / history ────────────────────────────────────────────

const HISTORY_FILE = (id) => path.join(TICKETS_DIR, id, "history.jsonl");

function appendHistory(identifier, entry) {
  const dir = path.join(TICKETS_DIR, identifier);
  ensureDir(dir);
  fs.appendFileSync(HISTORY_FILE(identifier), JSON.stringify(entry) + "\n");
}

export function getHistory(identifier) {
  const f = HISTORY_FILE(identifier);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── Bundled snapshot (one shot for widget bootstrap) ─────────────

export function getSnapshot() {
  return {
    meta: getMeta(),
    tickets: listTickets(),
    priorityLabels: PRIORITY_LABELS,
  };
}

// ── Bootstrap (called once at startup) ────────────────────────────

export function bootstrap() {
  ensureScaffold();
  return { ticketsDir: TICKETS_DIR, metaDir: META_DIR };
}

export const TICKETS_PATH = TICKETS_DIR;
