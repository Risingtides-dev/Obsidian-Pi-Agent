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
 * The dir name is --Users-risingtidesdev-dev-Thoth--
 */
function parseSessionName(dirName) {
  if (dirName === "obsidian-pi") {
    return { name: "obsidian-pi", projectPath: "Obsidian Vault", shortName: "Obsidian" };
  }
  // --Users-risingtidesdev-dev-Thoth-- → /Users/risingtidesdev/dev/Thoth
  // --Users-risingtidesdev-.worktrees-Thoth-mac-feature-- → worktree
  const clean = dirName.replace(/^--|--$/g, "");
  let projectPath;
  let shortName;
  let isWorktree = false;

  // Detect worktree marker: -.worktrees- in the path
  if (clean.includes("-.worktrees-") || clean.includes(".worktrees")) {
    isWorktree = true;
    // Users-risingtidesdev-.worktrees-Thoth-mac-feature
    // Split on the worktree boundary
    const parts = clean.split(/-\.worktrees-/);
    const baseStr = parts[0]; // Users-risingtidesdev-dev
    const worktree = parts[1] || clean.split(".worktrees-").pop(); // Thoth-mac-feature
    const baseClean = "/" + baseStr.replace(/^Users-/, "Users/").replace(/-/g, "/");
    projectPath = `${baseClean} (worktree: ${worktree.replace(/-/g, "/")})`;
    shortName = worktree.split("-").pop();
  } else {
    // Users-risingtidesdev-dev-Thoth → /Users/risingtidesdev/dev/Thoth
    projectPath = "/" + clean.replace(/-/g, "/");
    shortName = clean.split("-").pop();
  }

  return { name: dirName, projectPath, shortName, isWorktree };
}

/**
 * Get metadata for a session directory (last modified, session count, model).
 */
function getSessionMeta(dirName) {
  const dirPath = path.join(SESSIONS_DIR, dirName);
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));
    if (files.length === 0) return null;

    const stats = files.map(f => {
      const s = fs.statSync(path.join(dirPath, f));
      return { file: f, mtime: s.mtime };
    });
    stats.sort((a, b) => b.mtime - a.mtime);

    const newest = stats[0];
    const lastActivity = newest.mtime.toISOString();

    // Try to read model from the newest session file
    let model = "unknown";
    try {
      const content = fs.readFileSync(path.join(dirPath, newest.file), "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === "model_change") {
            model = entry.modelId || "unknown";
          }
        } catch {}
      }
    } catch {}

    return {
      sessionCount: files.length,
      lastActivity,
      lastFile: newest.file,
      model,
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
 * Read the latest N lines from a session's most recent JSONL file.
 */
export function readSessionHistory(sessionName, limit = 50) {
  const dirPath = getSessionPath(sessionName);
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));
    if (files.length === 0) return [];

    // Get newest file
    const newest = files.reduce((a, b) => {
      const sa = fs.statSync(path.join(dirPath, a));
      const sb = fs.statSync(path.join(dirPath, b));
      return sa.mtime > sb.mtime ? a : b;
    });

    const content = fs.readFileSync(path.join(dirPath, newest), "utf-8");
    const lines = content.split("\n").filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    return lines.slice(-limit);
  } catch {
    return [];
  }
}
