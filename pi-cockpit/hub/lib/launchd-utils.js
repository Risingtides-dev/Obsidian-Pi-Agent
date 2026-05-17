/**
 * Shared launchd utilities — used by daemon-monitor, routines-monitor, and server.
 *
 * Consolidates:
 *   - launchd plist load/unload (restartDaemon / reloadLaunchAgent)
 *   - log tail reading (readDaemonLog / readRoutineLog)
 *   - launchctl list parsing (used by daemon list + routines list)
 *   - path resolution (vault path, heartbeat path)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Path resolution ───────────────────────────────────────

/** Resolve the vault path at call time (not import time). */
export function getVaultPath() {
  return process.env.VAULT_PATH || path.join(os.homedir(), "dev", "{{AGENT_NAME}}");
}

export function getHeartbeatPath() {
  return path.join(getVaultPath(), "heartbeat.md");
}

export function getLogsDir() {
  return path.join(getVaultPath(), "logs");
}

// ── launchctl helpers ──────────────────────────────────────

/**
 * Parse `launchctl list | grep <label>` output.
 * Returns { loaded, pid, exitCode } or { loaded: false } if not found.
 */
export function getLaunchdStatus(label) {
  try {
    const out = execSync(`launchctl list | grep "${label}"`, {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (!out) return { loaded: false };
    const parts = out.split(/\s+/);
    return {
      loaded: true,
      pid: parts[0] === "-" ? null : parseInt(parts[0]),
      exitCode: parts.length > 1 ? parts[1] : null,
    };
  } catch {
    return { loaded: false };
  }
}

/**
 * Unload then load (or optionally just unload) a launchd plist.
 * @param {string} label - launchd label (e.g. "{{LAUNCHD_PREFIX}}.telegram-bot")
 * @param {boolean} [enabled=true] - if false, only unloads
 * @returns {{ success: boolean, message: string }}
 */
export function reloadLaunchd(label, enabled = true) {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
  if (!existsSync(plistPath)) {
    return { success: false, message: `plist not found: ${plistPath}` };
  }
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { timeout: 5000 });
  } catch { /* not loaded, that's fine */ }

  if (enabled) {
    try {
      execSync(`launchctl load "${plistPath}"`, { timeout: 5000 });
      return { success: true, message: `${label} loaded` };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
  return { success: true, message: `${label} unloaded` };
}

// ── Log reading ────────────────────────────────────────────

/**
 * Read the tail of a log file.
 * @param {string} logPath - absolute path to log file
 * @param {number} [lines=50] - number of lines to tail
 * @returns {{ success: boolean, content: string, lines: number, path: string }}
 */
export function readLogTail(logPath, lines = 50) {
  if (!existsSync(logPath)) {
    return { success: false, content: `Log file not found: ${logPath}`, lines: 0, path: logPath };
  }
  try {
    const content = execSync(`tail -n ${lines} "${logPath}"`, {
      encoding: "utf8",
      timeout: 3000,
    });
    const lineCount = content.split("\n").filter(Boolean).length;
    return { success: true, content, lines: lineCount, path: logPath };
  } catch (e) {
    return { success: false, content: e.message, lines: 0, path: logPath };
  }
}

/**
 * Get log freshness metadata.
 * @returns {{ lastLogEntry: string|null, logSize: number }}
 */
export function getLogMeta(logPath) {
  if (!existsSync(logPath)) return { lastLogEntry: null, logSize: 0 };
  const stat = statSync(logPath);
  return { lastLogEntry: stat.mtime.toISOString(), logSize: stat.size };
}

// ── Heartbeat parsing ──────────────────────────────────────

/**
 * Parse heartbeat.md for system status summary.
 * @returns {{ lastScan, overallStatus, criticalCount, warningCount } | null}
 */
export function parseHeartbeat(heartbeatPath) {
  try {
    if (!existsSync(heartbeatPath)) return null;
    const content = readFileSync(heartbeatPath, "utf8");
    const stat = statSync(heartbeatPath);

    const overallMatch = content.match(/Overall:\s*(🟢|🟡|🔴)\s*(\w+)/);
    const criticalMatch = content.match(/Critical:\s*(\d+)/);
    const warningsMatch = content.match(/Warnings:\s*(\d+)/);
    const scannedMatch = content.match(/Scanned:\s*([\d\-:\s]+)/);

    return {
      lastScan: scannedMatch ? scannedMatch[1].trim() : stat.mtime.toISOString(),
      overallStatus: overallMatch ? `${overallMatch[1]} ${overallMatch[2]}` : "unknown",
      criticalCount: criticalMatch ? parseInt(criticalMatch[1]) : 0,
      warningCount: warningsMatch ? parseInt(warningsMatch[1]) : 0,
    };
  } catch {
    return null;
  }
}
