/**
 * Routines Monitor — User-defined recurring tasks managed as launchd agents.
 *
 * Storage: ~/.pi/agent/routines/<name>/routine.json + SKILL.md
 *   routine.json: { name, description, schedule, folder, model, enabled, lastRun? }
 *   SKILL.md:    YAML frontmatter + prompt body
 *
 * launchd label: {{LAUNCHD_PREFIX}}.routine.<name>
 * launchd plist: ~/Library/LaunchAgents/{{LAUNCHD_PREFIX}}.routine.<name>.plist
 *
 * Schedule presets: "hourly" | "daily@HH:MM" | "weekdays@HH:MM" | "weekly@dow:HH:MM" | "manual"
 *   Internally converted to launchd StartCalendarInterval / StartInterval.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const HOME = os.homedir();
const ROUTINES_DIR = path.join(HOME, ".pi", "agent", "routines");
const LAUNCH_AGENTS = path.join(HOME, "Library", "LaunchAgents");
const LABEL_PREFIX = "{{LAUNCHD_PREFIX}}.routine.";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseSchedule(schedule) {
  if (!schedule || schedule === "manual") return null;
  if (schedule === "hourly") return { type: "interval", seconds: 3600 };
  const everyMatch = schedule.match(/^every@(\d+)$/);
  if (everyMatch) return { type: "interval", seconds: parseInt(everyMatch[1], 10) * 60 };
  const dailyMatch = schedule.match(/^daily@(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return { type: "calendar", entries: [{ Hour: parseInt(dailyMatch[1]), Minute: parseInt(dailyMatch[2]) }] };
  }
  const weekdaysMatch = schedule.match(/^weekdays@(\d{1,2}):(\d{2})$/);
  if (weekdaysMatch) {
    const H = parseInt(weekdaysMatch[1]), M = parseInt(weekdaysMatch[2]);
    return { type: "calendar", entries: [1, 2, 3, 4, 5].map(d => ({ Weekday: d, Hour: H, Minute: M })) };
  }
  const weeklyMatch = schedule.match(/^weekly@(\d):(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    return { type: "calendar", entries: [{ Weekday: parseInt(weeklyMatch[1]), Hour: parseInt(weeklyMatch[2]), Minute: parseInt(weeklyMatch[3]) }] };
  }
  return null;
}

function buildPlistXml({ label, scriptPath, schedule, folder, logPath }) {
  const parsed = parseSchedule(schedule);
  let scheduleBlock = "";
  if (parsed?.type === "interval") {
    scheduleBlock = `    <key>StartInterval</key>\n    <integer>${parsed.seconds}</integer>\n`;
  } else if (parsed?.type === "calendar") {
    if (parsed.entries.length === 1) {
      const e = parsed.entries[0];
      scheduleBlock = "    <key>StartCalendarInterval</key>\n    <dict>\n" +
        Object.entries(e).map(([k, v]) => `      <key>${k}</key>\n      <integer>${v}</integer>`).join("\n") +
        "\n    </dict>\n";
    } else {
      scheduleBlock = "    <key>StartCalendarInterval</key>\n    <array>\n" +
        parsed.entries.map(e => "      <dict>\n" +
          Object.entries(e).map(([k, v]) => `        <key>${k}</key>\n        <integer>${v}</integer>`).join("\n") +
          "\n      </dict>").join("\n") +
        "\n    </array>\n";
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${folder}</string>
${scheduleBlock}    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`;
}

function buildRunnerScript({ folder, skillPath, logPath }) {
  // Runs the routine prompt through `pi -p` (non-interactive mode).
  return `#!/bin/bash
set -e
cd "${folder}"
echo "[routine] $(date -Iseconds) starting" >> "${logPath}"
PROMPT=$(awk 'BEGIN{m=0} /^---$/{m++; next} m==2{print}' "${skillPath}")
if [ -z "$PROMPT" ]; then
  echo "[routine] empty prompt, skipping" >> "${logPath}"
  exit 0
fi
echo "$PROMPT" | pi -p >> "${logPath}" 2>&1
RC=$?
echo "[routine] $(date -Iseconds) done (exit $RC)" >> "${logPath}"
`;
}

export function listRoutines() {
  ensureDir(ROUTINES_DIR);
  let entries;
  try { entries = fs.readdirSync(ROUTINES_DIR, { withFileTypes: true }); }
  catch { return []; }

  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const cfgPath = path.join(ROUTINES_DIR, e.name, "routine.json");
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const label = LABEL_PREFIX + e.name;
      let loaded = false, pid = null;
      try {
        const out2 = execSync(`launchctl list | grep "${label}"`, { encoding: "utf8", timeout: 2000 }).trim();
        if (out2) {
          loaded = true;
          const parts = out2.split(/\s+/);
          pid = parts[0] === "-" ? null : parseInt(parts[0]);
        }
      } catch {}
      out.push({ ...cfg, slug: e.name, label, loaded, running: pid !== null, pid });
    } catch {}
  }
  out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return out;
}

export function getRoutine(slug) {
  const cfgPath = path.join(ROUTINES_DIR, slug, "routine.json");
  if (!fs.existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    const skillPath = path.join(ROUTINES_DIR, slug, "SKILL.md");
    const prompt = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf-8") : "";
    return { ...cfg, slug, prompt };
  } catch { return null; }
}

export function saveRoutine(spec) {
  if (!spec.name) throw new Error("name required");
  const slug = slugify(spec.name);
  if (!slug) throw new Error("invalid name");
  const dir = path.join(ROUTINES_DIR, slug);
  ensureDir(dir);

  const cfg = {
    name: spec.name,
    description: spec.description || "",
    schedule: spec.schedule || "manual",
    folder: spec.folder || HOME,
    model: spec.model || null,
    enabled: spec.enabled !== false,
    createdAt: spec.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "routine.json"), JSON.stringify(cfg, null, 2));

  const skillBody = `---
name: ${slug}
description: ${cfg.description.replace(/\n/g, " ")}
---

${spec.prompt || ""}
`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillBody);

  const skillPath = path.join(dir, "SKILL.md");
  const scriptPath = path.join(dir, "run.sh");
  const logPath = path.join(dir, "run.log");
  fs.writeFileSync(scriptPath, buildRunnerScript({ folder: cfg.folder, skillPath, logPath }), { mode: 0o755 });

  ensureDir(LAUNCH_AGENTS);
  const label = LABEL_PREFIX + slug;
  const plistPath = path.join(LAUNCH_AGENTS, `${label}.plist`);
  fs.writeFileSync(plistPath, buildPlistXml({ label, scriptPath, schedule: cfg.schedule, folder: cfg.folder, logPath }));
  reloadLaunchAgent(label, cfg.enabled);

  return { ...cfg, slug, label };
}

export function deleteRoutine(slug) {
  const label = LABEL_PREFIX + slug;
  const plistPath = path.join(LAUNCH_AGENTS, `${label}.plist`);
  try { execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { timeout: 3000 }); } catch {}
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  const dir = path.join(ROUTINES_DIR, slug);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

export function toggleRoutine(slug, enabled) {
  const cfgPath = path.join(ROUTINES_DIR, slug, "routine.json");
  if (!fs.existsSync(cfgPath)) throw new Error("not found");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.enabled = !!enabled;
  cfg.updatedAt = new Date().toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  reloadLaunchAgent(LABEL_PREFIX + slug, cfg.enabled);
  return { ok: true, enabled: cfg.enabled };
}

export function runRoutineNow(slug) {
  const dir = path.join(ROUTINES_DIR, slug);
  const scriptPath = path.join(dir, "run.sh");
  if (!fs.existsSync(scriptPath)) throw new Error("no runner script");
  try {
    execSync(`/bin/bash "${scriptPath}" &`, { timeout: 3000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function reloadLaunchAgent(label, enabled) {
  const plistPath = path.join(LAUNCH_AGENTS, `${label}.plist`);
  if (!fs.existsSync(plistPath)) return;
  try { execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { timeout: 3000 }); } catch {}
  if (enabled) {
    try { execSync(`launchctl load "${plistPath}"`, { timeout: 3000 }); } catch {}
  }
}

export function readRoutineLog(slug, lines = 50) {
  const logPath = path.join(ROUTINES_DIR, slug, "run.log");
  if (!fs.existsSync(logPath)) return { success: false, content: "No log yet", lines: 0 };
  try {
    const content = execSync(`tail -n ${lines} "${logPath}"`, { encoding: "utf8", timeout: 2000 });
    return { success: true, content, lines: content.split("\n").length, path: logPath };
  } catch (e) {
    return { success: false, content: e.message, lines: 0 };
  }
}
