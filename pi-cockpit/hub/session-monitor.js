/**
 * Monitors ~/.pi/agent/sessions/ for active PI coding agent sessions.
 * Reads session metadata (project name, last activity, model, etc.)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { state } from "./state.js";

const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const IGNORE = [".DS_Store"];

/**
 * Parse a session directory name back to a project path.
 * The dir name is --{{OS_USERNAME}}-dev-{{AGENT_NAME}}--
 */
function parseSessionName(dirName) {
  if (dirName === "obsidian-pi") {
    return {
      name: "obsidian-pi",
      projectPath: "Obsidian Vault",
      cwd: path.join(os.homedir(), "dev", "{{AGENT_NAME}}"),
      shortName: "Obsidian",
    };
  }
  // --{{OS_USERNAME}}-dev-{{AGENT_NAME}}-- → {{VAULT_PATH}}
  // --{{OS_USERNAME}}-.worktrees-{{AGENT_NAME}}-pi-cockpit-- → {{HOME_PATH}}/.worktrees/{{AGENT_NAME}}-pi-cockpit
  const clean = dirName.replace(/^--|--$/g, "");
  let projectPath;          // Human-readable label (shown in UI)
  let cwd;                  // Actual filesystem path PI agent should chdir into
  let shortName;
  let isWorktree = false;

  if (clean.includes("-.worktrees-") || clean.includes(".worktrees")) {
    isWorktree = true;
    // {{OS_USERNAME}}-.worktrees-{{AGENT_NAME}}-pi-cockpit
    // Split on the worktree boundary
    const parts = clean.split(/-\.worktrees-/);
    const baseStr = parts[0]; // e.g. "{{OS_USERNAME}}"
    const worktreeStr = parts[1] || clean.split(".worktrees-").pop(); // "{{AGENT_NAME}}-pi-cockpit"
    const baseClean = "/" + baseStr.replace(/^Users-/, "Users/").replace(/-/g, "/");
    // The real worktree dir contains hyphens in its leaf name and lives under .worktrees/
    cwd = path.join(baseClean, ".worktrees", worktreeStr);
    projectPath = cwd;
    shortName = worktreeStr.split("-").slice(1).join("-") || worktreeStr;
  } else {
    // vault-root → {{VAULT_PATH}}
    cwd = "/" + clean.replace(/-/g, "/");
    projectPath = cwd;
    shortName = clean.split("-").pop();
  }

  // Verify the resolved cwd actually exists on disk; if not, leave cwd unset
  // so the bridge falls back rather than chdir'ing into a phantom path.
  try {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      cwd = null;
    }
  } catch {
    cwd = null;
  }

  return { name: dirName, projectPath, cwd, shortName, isWorktree };
}

/**
 * Read the last model_change entry from a JSONL session file.
 * Returns "unknown" if not found or file unreadable.
 */
function readModelFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let model = "unknown";
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "model_change") model = entry.modelId || model;
      } catch {}
    }
    return model;
  } catch {
    return "unknown";
  }
}

/**
 * Extract a human-readable title from a JSONL filename.
 * Filename format: 2026-05-10T23-29-07-197Z_019e1439-...jsonl
 * → "2026-05-10 23:29" (date and time)
 */
function fileToTitle(file) {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  if (m) return `${m[1]} ${m[2]}:${m[3]}`;
  return file.replace(/\.jsonl$/, "");
}

/**
 * Get metadata for a session directory: every JSONL file, sorted newest-first.
 */
function getSessionMeta(dirName) {
  const dirPath = path.join(SESSIONS_DIR, dirName);
  try {
    const filenames = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));
    if (filenames.length === 0) return null;

    const files = filenames.map(f => {
      const filePath = path.join(dirPath, f);
      const s = fs.statSync(filePath);
      return {
        file: f,
        title: fileToTitle(f),
        mtime: s.mtime,
        lastActivity: s.mtime.toISOString(),
        size: s.size,
        model: readModelFromFile(filePath),
      };
    });
    files.sort((a, b) => b.mtime - a.mtime);

    const newest = files[0];
    return {
      sessionCount: files.length,
      lastActivity: newest.lastActivity,
      lastFile: newest.file,
      model: newest.model,
      // Strip mtime (Date object) before serializing — keep only ISO strings.
      files: files.map(({ mtime, ...rest }) => rest),
    };
  } catch {
    return null;
  }
}

/**
 * Scan all PI sessions and update state.
 */
export function scanSessions() {
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !IGNORE.includes(e.name));

    // If no current session set, default to most recent
    if (!state.currentSession && dirs.length > 0) {
      // Quick scan to find the most recent
      let newest = null;
      let newestTime = 0;
      for (const dir of dirs) {
        const meta = getSessionMeta(dir.name);
        if (meta && new Date(meta.lastActivity).getTime() > newestTime) {
          newest = dir.name;
          newestTime = new Date(meta.lastActivity).getTime();
        }
      }
      if (newest) state.currentSession = newest;
    }

    state.sessions = dirs.map(dir => {
      const parsed = parseSessionName(dir.name);
      const meta = getSessionMeta(dir.name);
      return {
        ...parsed,
        ...meta,
        active: state.currentSession === dir.name,
      };
    }).filter(s => s.sessionCount);

    // Sort by most recent activity
    state.sessions.sort((a, b) =>
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
  } catch (err) {
    console.error("[session-monitor] Error scanning sessions:", err.message);
  }
}

/**
 * Get the directory path for a session.
 */
export function getSessionPath(sessionName) {
  return path.join(SESSIONS_DIR, sessionName);
}

/**
 * Read the latest N lines from a session's JSONL file.
 * @param {string} sessionName - Session directory name (encoded project path).
 * @param {number} [limit=50] - Max entries to return from end of file.
 * @param {string} [file] - Specific JSONL filename inside the session dir.
 *                          If omitted, picks the most recent.
 */
export function readSessionHistory(sessionName, limit = 50, file = null) {
  const dirPath = getSessionPath(sessionName);
  try {
    let target = file;
    if (!target) {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));
      if (files.length === 0) return [];
      target = files.reduce((a, b) => {
        const sa = fs.statSync(path.join(dirPath, a));
        const sb = fs.statSync(path.join(dirPath, b));
        return sa.mtime > sb.mtime ? a : b;
      });
    }

    const filePath = path.join(dirPath, target);
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    return lines.slice(-limit);
  } catch {
    return [];
  }
}
