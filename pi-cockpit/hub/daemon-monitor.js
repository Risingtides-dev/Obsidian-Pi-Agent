/**
 * Daemon Monitor — Tracks launchd daemons for PI Cockpit.
 * Reads launchctl, log files, and heartbeat.md for real-time status.
 *
 * Uses shared utilities from ./lib/launchd-utils.js (vault path resolution,
 * launchctl status parsing, log tail reading, heartbeat parsing).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  getVaultPath,
  getHeartbeatPath,
  getLogsDir,
  getLaunchdStatus,
  reloadLaunchd,
  readLogTail,
  getLogMeta,
  parseHeartbeat,
} from "./lib/launchd-utils.js";

const DAEMONS = [
  "com.thoth.telegram-bot",
  "com.thoth.living-dashboard",
  "com.thoth.scratchpad-watcher",
  "com.thoth.canvas-watcher",
  "com.thoth.pi-cockpit",
  "com.thoth.vaultkeeper-heartbeat",
];

/**
 * Get live status for all Thoth daemons.
 */
export function scanDaemons() {
  const logsDir = getLogsDir();
  const results = [];

  for (const label of DAEMONS) {
    const name = label.replace("com.thoth.", "");
    const status = getLaunchdStatus(label);

    // Log freshness
    const logPath = path.join(logsDir, `${name}.log`);
    const { lastLogEntry, logSize } = getLogMeta(logPath);

    // Count errors in stderr
    const errPath = path.join(logsDir,
      name.includes("vaultkeeper") ? "vaultkeeper-heartbeat-err.log" : `${name}-err.log`);
    let errorCount = 0;
    if (existsSync(errPath)) {
      try {
        const errContent = readFileSync(errPath, "utf8");
        errorCount = (errContent.match(/error|Error|ERROR/g) || []).length;
      } catch { /* ignore read errors */ }
    }

    results.push({
      label,
      name,
      loaded: status.loaded,
      running: status.pid !== null,
      pid: status.pid || null,
      exitCode: status.exitCode || null,
      lastLogEntry,
      logSize,
      errorCount,
    });
  }

  return results;
}

/**
 * Read heartbeat.md for overall system status.
 */
export function readHeartbeat() {
  return parseHeartbeat(getHeartbeatPath());
}

/**
 * Restart a daemon by label.
 */
export function restartDaemon(label) {
  const result = reloadLaunchd(label, true);
  // Adapt the shared utility's generic message to daemon-specific language
  return {
    success: result.success,
    message: result.success && result.message.includes("loaded")
      ? `${label} restarted`
      : result.message,
  };
}

/**
 * Read the tail of a daemon's log file.
 */
export function readDaemonLog(label, tailLines = 50) {
  const name = label.replace("com.thoth.", "");
  const logPath = path.join(getLogsDir(), `${name}.log`);
  return readLogTail(logPath, tailLines);
}
