/**
 * Daemon Monitor — Tracks launchd daemons for PI Cockpit.
 * Reads launchctl, log files, and heartbeat.md for real-time status.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const VAULT = "/Users/risingtidesdev/dev/Thoth";
const LOGS_DIR = path.join(VAULT, "logs");
const HEARTBEAT_PATH = path.join(VAULT, "heartbeat.md");

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
  const results = [];

  for (const label of DAEMONS) {
    const name = label.replace("com.thoth.", "");
    let pid = null;
    let exitCode = null;
    let loaded = false;

    try {
      const out = execSync(`launchctl list | grep "${label}"`, {
        encoding: "utf8",
        timeout: 3000,
      }).trim();

      if (out) {
        loaded = true;
        const parts = out.split(/\s+/);
        pid = parts[0] === "-" ? null : parseInt(parts[0]);
        exitCode = parts.length > 1 ? parts[1] : null;
      }
    } catch {
      // Daemon not loaded
    }

    // Check log freshness
    const logPath = path.join(LOGS_DIR, `${name}.log`);
    let lastLogEntry = null;
    let logSize = 0;
    if (existsSync(logPath)) {
      const stat = statSync(logPath);
      lastLogEntry = stat.mtime.toISOString();
      logSize = stat.size;
    }

    // Count errors in stderr
    const errPath = path.join(LOGS_DIR, name.includes("vaultkeeper") 
      ? "vaultkeeper-heartbeat-err.log" 
      : `${name}-err.log`);
    let errorCount = 0;
    if (existsSync(errPath)) {
      try {
        const errContent = readFileSync(errPath, "utf8");
        errorCount = (errContent.match(/error|Error|ERROR/g) || []).length;
      } catch {}
    }

    results.push({
      label,
      name,
      loaded,
      running: pid !== null,
      pid,
      exitCode,
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
  try {
    if (!existsSync(HEARTBEAT_PATH)) return null;

    const content = readFileSync(HEARTBEAT_PATH, "utf8");
    const stat = statSync(HEARTBEAT_PATH);

    // Extract overall status
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

/**
 * Restart a daemon by label.
 * Returns { success, message }
 */
export function restartDaemon(label) {
  try {
    execSync(`launchctl unload ~/Library/LaunchAgents/${label}.plist 2>/dev/null || true`, {
      timeout: 5000,
      shell: "/bin/bash",
    });
  } catch {}

  try {
    execSync(`launchctl load ~/Library/LaunchAgents/${label}.plist`, { timeout: 5000 });
    return { success: true, message: `${label} restarted` };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Read the tail of a daemon's log file.
 * Returns { success, content, lines }
 */
export function readDaemonLog(label, tailLines = 50) {
  const name = label.replace("com.thoth.", "");
  const logPath = path.join(LOGS_DIR, `${name}.log`);

  if (!existsSync(logPath)) {
    return { success: false, content: `Log file not found: ${logPath}`, lines: 0 };
  }

  try {
    const content = execSync(`tail -n ${tailLines} "${logPath}"`, {
      encoding: "utf8",
      timeout: 3000,
    });
    const lineCount = content.split("\n").filter(Boolean).length;
    return { success: true, content, lines: lineCount, path: logPath };
  } catch (e) {
    return { success: false, content: e.message, lines: 0 };
  }
}
