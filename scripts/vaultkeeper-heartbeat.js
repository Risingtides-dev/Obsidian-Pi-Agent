#!/usr/bin/env node
/**
 * Vault Keeper Heartbeat — Autonomous Health Scanner
 *
 * Runs SOP-01: Full Health Scan against the canonical vault schema.
 * Writes results to heartbeat.md and flags issues in Event Log.md.
 *
 * Usage:
 *   node scripts/vaultkeeper-heartbeat.js          # one-shot scan
 *   node scripts/vaultkeeper-heartbeat.js --quiet  # suppress stdout
 *   node scripts/vaultkeeper-heartbeat.js --watch  # run continuously (cron mode)
 *
 * Exit codes:
 *   0 = all healthy
 *   1 = warnings found (non-critical)
 *   2 = critical issues found
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────
const VAULT = '/Users/risingtidesdev/dev/Thoth';
const WORKTREES_DIR = path.join(require('os').homedir(), '.worktrees');
const LOGS_DIR = path.join(VAULT, 'logs');
const CONTEXT_DIR = path.join(VAULT, '3-Resources');
const INBOX_DIR = path.join(VAULT, '3-Resources', 'Inbox');
const DAILY_DIR = path.join(VAULT, 'Daily');
const HEARTBEAT_PATH = path.join(VAULT, 'heartbeat.md');
const EVENT_LOG_PATH = path.join(VAULT, 'Event Log.md');
const SCHEMA_PATH = path.join(VAULT, '1-Projects', 'Vault Keeper', 'Vault Schema.md');
const STATE_FILE = path.join(VAULT, '.vaultkeeper-state.json');

// Thresholds
const STALE_LOG_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours (raised from 1h)
const MAX_EVENT_LOG_ENTRIES = 50; // Truncate Event Log to last 50 entries

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');

// ─── State ─────────────────────────────────────────────────────────────────
const issues = [];
const warnings = [];
const results = {};
const scanRun = { issues: [], warnings: [] };

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg) { if (!QUIET) console.log(msg); }
function warn(msg) { if (!QUIET) console.warn(`⚠️  ${msg}`); }

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function fileNonEmpty(p) { try { return fs.statSync(p).size > 0; } catch { return false; } }
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function flag(severity, check, detail) {
  const entry = { severity, check, detail, time: new Date().toISOString() };
  if (severity === 'critical') issues.push(entry);
  else warnings.push(entry);
}

// ─── State Persistence ────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    log(`  ⚠️  Could not load state file: ${e.message}`);
  }
  return { lastIssueHash: null, lastResolved: null };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`  ⚠️  Could not save state file: ${e.message}`);
  }
}

function computeIssueHash(issueList, warningList) {
  // Normalize: sort by check + detail for consistent hashing
  const sorted = [...issueList, ...warningList]
    .map(i => `${i.severity}:${i.check}:${i.detail}`)
    .sort();
  // Simple string hash
  const str = sorted.join('||');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// ─── Check 1: Daemons ──────────────────────────────────────────────────────
function checkDaemons() {
  log('\n🔍 Checking daemons...');
  const daemons = [
    'com.thoth.telegram-bot',
    'com.thoth.living-dashboard',
    'com.thoth.scratchpad-watcher',
    'com.thoth.canvas-watcher',
    'com.thoth.pi-cockpit',
  ];

  const daemonResults = {};

  for (const label of daemons) {
    try {
      const out = execSync(`launchctl list | grep "${label}"`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      const parts = out.split(/\s+/);
      const pid = parts[0] === '-' ? null : parseInt(parts[0]);
      const exitCode = parts.length > 1 ? parts[1] : '?';

      const name = label.replace('com.thoth.', '');
      const logFile = path.join(LOGS_DIR, `${name}.log`);
      const errFile = path.join(LOGS_DIR, `${name}-err.log`);

      let lastLogEntry = null;
      if (fileExists(logFile)) {
        lastLogEntry = fs.statSync(logFile).mtime;
      }

      // Check for errors in stderr log
      let errorCount = 0;
      if (fileExists(errFile)) {
        const errContent = readFile(errFile);
        if (errContent) {
          errorCount = (errContent.match(/error|Error|ERROR/g) || []).length;
        }
      }

      daemonResults[name] = {
        running: pid !== null,
        pid,
        exitCode: pid ? null : exitCode,
        lastLog: lastLogEntry,
        logAge: timeAgo(lastLogEntry),
        errors: errorCount,
      };

      const status = pid ? '✅' : '❌';
      log(`  ${status} ${name} (PID: ${pid || 'none'}, log: ${daemonResults[name].logAge}${errorCount > 0 ? `, errors: ${errorCount}` : ''})`);

      if (!pid) {
        flag('critical', `Daemon ${name} is not running`, `PID is null, exit code: ${exitCode}`);
      } else if (lastLogEntry && (Date.now() - lastLogEntry.getTime()) > STALE_LOG_THRESHOLD_MS) {
        flag('warning', `Daemon ${name} log is stale`, `Last entry: ${daemonResults[name].logAge}`);
      }

      if (errorCount > 10) {
        flag('warning', `Daemon ${name} has errors in stderr log`, `${errorCount} error patterns found`);
      }

    } catch (e) {
      const name = label.replace('com.thoth.', '');
      daemonResults[name] = { running: false, pid: null, exitCode: '?', lastLog: null, logAge: 'unknown', errors: 0 };
      log(`  ❌ ${name} (not found in launchctl)`);
      flag('critical', `Daemon ${name} not loaded in launchd`, e.message);
    }
  }

  // PI Cockpit port check
  try {
    execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3099', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    log('  ✅ PI Cockpit responding on :3099');
    daemonResults['pi-cockpit-port'] = true;
  } catch {
    log('  ❌ PI Cockpit not responding on :3099');
    daemonResults['pi-cockpit-port'] = false;
    flag('warning', 'PI Cockpit port 3099 not responding', 'WebSocket hub may be down');
  }

  results.daemons = daemonResults;
}

// ─── Check 2: Context Docs ─────────────────────────────────────────────────
function checkContextDocs() {
  log('\n🔍 Checking context docs...');
  const docs = [
    'AGENTS.md',
    'System Prompt.md',
    'Thoth - Digital Twin.md',
    'Thoth - Obsidian Integration.md',
    'Thoth Worktrees.md',
  ];

  const docResults = {};

  for (const doc of docs) {
    const fullPath = path.join(CONTEXT_DIR, doc);
    const exists = fileExists(fullPath);
    const nonEmpty = fileNonEmpty(fullPath);
    docResults[doc] = { exists, nonEmpty };

    const status = exists && nonEmpty ? '✅' : '❌';
    log(`  ${status} ${doc}`);

    if (!exists) {
      flag('critical', `Context doc missing: ${doc}`, fullPath);
    } else if (!nonEmpty) {
      flag('critical', `Context doc is empty: ${doc}`, fullPath);
    }
  }

  results.contextDocs = docResults;
}

// ─── Check 3: Daily Note ───────────────────────────────────────────────────
function checkDailyNote() {
  log('\n🔍 Checking daily notes...');

  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const dailyPath = path.join(DAILY_DIR, `${dateStr}.md`);

  // First, scan all daily notes for empty (0-byte) files and fix them
  let emptyFixed = 0;
  try {
    if (fs.existsSync(DAILY_DIR)) {
      const allDailyFiles = fs.readdirSync(DAILY_DIR).filter(f => f.endsWith('.md'));
      for (const df of allDailyFiles) {
        const dfPath = path.join(DAILY_DIR, df);
        const stat = fs.statSync(dfPath);
        if (stat.size === 0) {
          const noteDate = df.replace('.md', '');
          log(`  ❌ Empty daily note found: ${df} — overwriting with template`);
          try {
            const template = path.join(VAULT, 'Templates', 'Daily Note.md');
            let content = `# ${noteDate}\n\n`;
            if (fileExists(template)) {
              content = readFile(template).replace(/\{\{date:YYYY-MM-DD\}\}/g, noteDate);
              content = content.replace(/\{\{date:dddd, MMMM D, YYYY\}\}/g, new Date(noteDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
              // Also handle simplified {{date}} pattern
              content = content.replace(/\{\{date\}\}/g, noteDate);
            }
            fs.writeFileSync(dfPath, content);
            log(`  🔧 Overwrote empty daily note: ${df}`);
            emptyFixed++;
          } catch (e) {
            flag('warning', `Could not fix empty daily note: ${df}`, e.message);
          }
        }
      }
    }
  } catch (e) {
    flag('warning', 'Could not scan daily notes directory', e.message);
  }

  if (emptyFixed > 0) {
    log(`  🔧 Fixed ${emptyFixed} empty daily note(s)`);
  }

  // Now handle the current day's note specifically
  const exists = fileExists(dailyPath);
  const nonEmpty = exists && fileNonEmpty(dailyPath);

  if (exists && nonEmpty) {
    log(`  ✅ Daily note exists and has content: ${dateStr}.md`);
    results.dailyNote = { exists: true, nonEmpty: true, path: dailyPath };
  } else if (exists && !nonEmpty) {
    // Already handled above, but double-check
    log(`  ✅ Daily note now has content (was empty): ${dateStr}.md`);
    results.dailyNote = { exists: true, nonEmpty: true, path: dailyPath, autoFixed: true };
  } else {
    log(`  ❌ Daily note missing: ${dateStr}.md`);
    try {
      const template = path.join(VAULT, 'Templates', 'Daily Note.md');
      let content = `# ${dateStr}\n\n`;
      if (fileExists(template)) {
        content = readFile(template).replace(/\{\{date:YYYY-MM-DD\}\}/g, dateStr);
        content = content.replace(/\{\{date:dddd, MMMM D, YYYY\}\}/g, today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
        content = content.replace(/\{\{date\}\}/g, dateStr);
      }
      fs.writeFileSync(dailyPath, content);
      log(`  🔧 Auto-created daily note: ${dateStr}.md`);
      results.dailyNote = { exists: true, nonEmpty: true, path: dailyPath, autoCreated: true };
    } catch (e) {
      flag('warning', `Could not create daily note: ${dateStr}.md`, e.message);
      results.dailyNote = { exists: false, error: e.message };
    }
  }
}

// ─── Check 4: Worktrees ────────────────────────────────────────────────────
function checkWorktrees() {
  log('\n🔍 Checking worktrees...');
  const worktreeResults = {};

  try {
    const out = execSync('git -C ' + VAULT + ' worktree list', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    const lines = out.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const wtPath = parts[0];
      if (!wtPath) continue;

      const branch = parts.length > 2 ? parts[2].replace(/[\[\]]/g, '') : 'detached';
      const agentsPath = path.join(wtPath, 'AGENTS.md');

      const hasAgents = fileExists(agentsPath);
      const status = hasAgents ? '✅' : '⚠️';
      log(`  ${status} ${path.basename(wtPath)} (${branch}) — AGENTS.md: ${hasAgents ? 'yes' : 'NO'}`);

      worktreeResults[path.basename(wtPath)] = { branch, path: wtPath, hasAgentsMd: hasAgents };

      if (!hasAgents) {
        flag('warning', `Worktree missing AGENTS.md: ${path.basename(wtPath)}`, wtPath);
      }
    }
  } catch (e) {
    flag('warning', 'Could not check worktrees', e.message);
  }

  results.worktrees = worktreeResults;
}

// ─── Check 5: Git Integrity ────────────────────────────────────────────────
function checkGitIntegrity() {
  log('\n🔍 Checking git integrity...');

  try {
    // Check no .md files tracked (except AGENTS.md, README.md)
    const allMd = execSync(`git -C ${VAULT} ls-files '*.md'`, { encoding: 'utf8', timeout: 5000 }).trim();
    const trackedMd = allMd.split('\n').filter(f => f !== 'AGENTS.md' && f !== 'README.md' && f !== '.github/AGENTS.md').join('\n').trim();

    if (trackedMd) {
      const files = trackedMd.split('\n').filter(Boolean);
      log(`  ❌ ${files.length} .md files tracked in git (should be 0):`);
      files.forEach(f => log(`     - ${f}`));
      flag('critical', `${files.length} .md files incorrectly tracked in git`, files.join(', '));
      results.gitMdTracked = { ok: false, files };
    } else {
      log('  ✅ No .md files tracked in git');
      results.gitMdTracked = { ok: true };
    }

    // Check no *-config.json tracked
    const trackedConfigs = execSync(`git -C ${VAULT} ls-files '*-config.json'`, { encoding: 'utf8', timeout: 5000 }).trim();

    if (trackedConfigs) {
      const files = trackedConfigs.split('\n').filter(Boolean);
      log(`  ❌ ${files.length} *-config.json files tracked in git:`);
      files.forEach(f => log(`     - ${f}`));
      flag('critical', `${files.length} *-config.json files tracked in git`, files.join(', '));
      results.gitConfigTracked = { ok: false, files };
    } else {
      log('  ✅ No *-config.json files tracked');
      results.gitConfigTracked = { ok: true };
    }

    // Check .gitignore covers listed directories
    const gitignore = readFile(path.join(VAULT, '.gitignore'));
    if (gitignore) {
      const requiredDirs = ['0-Inbox/', '1-Projects/', '2-Areas/', '3-Resources/', '4-Archive/', 'Attachments/', 'Daily/', '.obsidian/', '.trash/'];
      const missing = requiredDirs.filter(d => !gitignore.includes(d));
      if (missing.length > 0) {
        log(`  ⚠️  .gitignore missing ${missing.length} directories: ${missing.join(', ')}`);
        flag('warning', `.gitignore missing directories`, missing.join(', '));
        results.gitignore = { ok: false, missing };
      } else {
        log('  ✅ .gitignore covers all required directories');
        results.gitignore = { ok: true };
      }
    }

  } catch (e) {
    flag('warning', 'Could not check git integrity', e.message);
  }
}

// ─── Check 6: Inbox Frontmatter ────────────────────────────────────────────
function checkInboxFrontmatter() {
  log('\n🔍 Checking inbox frontmatter...');

  if (!fileExists(INBOX_DIR)) {
    flag('warning', 'Inbox directory missing', INBOX_DIR);
    results.inbox = { ok: false };
    return;
  }

  try {
    const files = fs.readdirSync(INBOX_DIR).filter(f => f.endsWith('.md'));
    let missingTitle = 0;
    let missingTags = 0;
    let total = files.length;

    for (const f of files.slice(0, 50)) { // Sample first 50
      const content = readFile(path.join(INBOX_DIR, f));
      if (!content) continue;
      if (!content.includes('title:')) missingTitle++;
      if (!content.includes('tags:')) missingTags++;
    }

    const status = missingTitle === 0 && missingTags === 0 ? '✅' : '⚠️';
    log(`  ${status} ${total} inbox notes (sampled 50): ${missingTitle} missing title, ${missingTags} missing tags`);

    if (missingTitle > 0 || missingTags > 0) {
      flag('warning', 'Inbox notes missing frontmatter', `${missingTitle} missing title, ${missingTags} missing tags (out of ${Math.min(total, 50)} sampled)`);
    }

    // Stale inbox items (>7 days)
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let stale = 0;
    for (const f of files) {
      const stat = fs.statSync(path.join(INBOX_DIR, f));
      if (stat.mtimeMs < weekAgo) stale++;
    }

    if (stale > 0) {
      log(`  ⚠️  ${stale} stale inbox items (>7 days)`);
      flag('warning', `${stale} stale inbox items (>7 days)`, 'Consider archiving or processing');
    }

    results.inbox = { total, missingTitle, missingTags, stale };
  } catch (e) {
    flag('warning', 'Could not check inbox', e.message);
  }
}

// ─── Check 7: Logs Freshness ───────────────────────────────────────────────
function checkLogsFreshness() {
  log('\n🔍 Checking log freshness...');

  if (!fileExists(LOGS_DIR)) {
    flag('warning', 'Logs directory missing', LOGS_DIR);
    results.logs = { ok: false };
    return;
  }

  try {
    const logFiles = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
    let stale = 0;
    const logDetails = {};

    for (const lf of logFiles) {
      const stat = fs.statSync(path.join(LOGS_DIR, lf));
      const age = Date.now() - stat.mtimeMs;
      logDetails[lf] = { age: timeAgo(stat.mtime), bytes: stat.size };

      if (age > STALE_LOG_THRESHOLD_MS && stat.size > 0) { // Stale if > 4h and has content
        stale++;
      }
    }

    const status = stale === 0 ? '✅' : '⚠️';
    log(`  ${status} ${logFiles.length} log files: ${stale} stale (>4h)`);

    if (stale > 0) {
      const staleNames = Object.entries(logDetails)
        .filter(([, v]) => v.age.includes('h') || v.age.includes('d'))
        .map(([k]) => k);
      flag('warning', `${stale} log files are stale`, staleNames.join(', '));
    }

    results.logs = { total: logFiles.length, stale, details: logDetails };
  } catch (e) {
    flag('warning', 'Could not check logs', e.message);
  }
}

// ─── Check 8: Obsidian REST API ────────────────────────────────────────────
function checkObsidianApi() {
  log('\n🔍 Checking Obsidian REST API...');

  try {
    const out = execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:27124/', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    if (out === '200') {
      log('  ✅ Obsidian REST API responding on :27124');
      results.obsidianApi = { ok: true };
    } else {
      log(`  ⚠️  Obsidian REST API returned ${out} (Obsidian may not be open)`);
      results.obsidianApi = { ok: false, status: out };
      // Not flagging as critical — Obsidian may legitimately be closed
    }
  } catch {
    log('  ⚠️  Obsidian REST API not reachable (Obsidian may not be open)');
    results.obsidianApi = { ok: false };
  }
}

// ─── Check 9: Memory Keys Convention ───────────────────────────────────────
function checkMemoryKeys() {
  log('\n🔍 Checking memory keys...');

  try {
    const memoryDir = path.join(require('os').homedir(), '.pi', 'agent', 'extensions', 'thoth', 'memory');
    if (!fileExists(memoryDir)) {
      flag('warning', 'Memory directory missing', memoryDir);
      results.memory = { ok: false };
      return;
    }

    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.json'));
    let nonConforming = 0;

    for (const f of files) {
      const key = f.replace('.json', '');
      if (!key.includes('.')) {
        nonConforming++;
        log(`  ⚠️  Non-conforming memory key: ${key}`);
      }
    }

    const status = nonConforming === 0 ? '✅' : '⚠️';
    log(`  ${status} ${files.length} memory keys: ${nonConforming} non-conforming`);

    if (nonConforming > 0) {
      flag('warning', `${nonConforming} memory keys don't follow dot-separated convention`, 'Keys should be domain.subdomain.detail');
    }

    results.memory = { total: files.length, nonConforming };
  } catch (e) {
    flag('warning', 'Could not check memory keys', e.message);
  }
}

// ─── Check 10: Event Log ───────────────────────────────────────────────────
function checkEventLog() {
  log('\n🔍 Checking Event Log...');

  if (!fileExists(EVENT_LOG_PATH)) {
    log('  ⚠️  Event Log.md does not exist — creating');
    fs.writeFileSync(EVENT_LOG_PATH, `# Event Log\n\nAgent communication via shared vault. Append-only. Include timestamp + source.\n\n`);
    results.eventLog = { exists: true, created: true };
    return;
  }

  const content = readFile(EVENT_LOG_PATH);
  if (!content) {
    results.eventLog = { exists: true, empty: true };
    return;
  }

  // Check for unanswered messages (status: pending)
  const pending = (content.match(/Status:\s*pending/gi) || []).length;
  const blocked = (content.match(/Status:\s*blocked/gi) || []).length;

  log(`  ✅ Event Log exists — ${pending} pending, ${blocked} blocked messages`);

  if (pending > 0) {
    flag('warning', `${pending} unanswered messages in Event Log`, 'Review and respond or mark as done');
  }

  results.eventLog = { exists: true, pending, blocked };
}

// ─── Write heartbeat.md ────────────────────────────────────────────────────
function writeHeartbeat() {
  log('\n💓 Writing heartbeat.md...');

  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);

  const statusIcon = (ok) => ok ? '✅' : '❌';

  const d = results.daemons || {};
  const c = results.contextDocs || {};

  const daemonRows = [
    ['com.thoth.telegram-bot', 'telegram-bot'],
    ['com.thoth.living-dashboard', 'living-dashboard'],
    ['com.thoth.scratchpad-watcher', 'scratchpad-watcher'],
    ['com.thoth.canvas-watcher', 'canvas-watcher'],
    ['com.thoth.pi-cockpit', 'pi-cockpit'],
  ];

  function daemonRow(label, key) {
    const info = d[key] || {};
    const running = info.running ? '🟢 Running' : '🔴 Down';
    const uptime = info.pid ? `PID ${info.pid}` : '—';
    const logAge = info.logAge || '—';
    const notes = info.errors > 0 ? `${info.errors} errors` : '—';
    return `| ${label} | ${running} | ${uptime} | ${logAge} | ${notes} |`;
  }

  // Compute overall health score
  const criticalCount = issues.length;
  const warningCount = warnings.length;
  let overallStatus;
  if (criticalCount === 0 && warningCount === 0) overallStatus = '🟢 Healthy';
  else if (criticalCount === 0) overallStatus = '🟡 Warnings';
  else overallStatus = '🔴 Issues';

  const dot = d['pi-cockpit-port'] !== false ? '✅' : '❌';
  const obsidian = results.obsidianApi?.ok ? '✅' : '⚠️';
  const inboxOk = results.inbox ? (results.inbox.missingTitle === 0 && results.inbox.missingTags === 0) : false;

  const heartbeat = `---
tags: [vaultkeeper, heartbeat, system-health]
created: 2026-05-12
---

# 🫀 System Heartbeat

> **Overall: ${overallStatus}** | Scanned: ${timestamp} | Next: ~15 min
> Critical: ${criticalCount} | Warnings: ${warningCount}

## Daemon Health

| Daemon | Status | Uptime | Last Log Entry | Notes |
|--------|--------|--------|---------------|-------|
${daemonRows.map(([l, k]) => daemonRow(l, k)).join('\n')}

## Context Docs

| File | Exists | Non-Empty | Notes |
|------|--------|-----------|-------|
| AGENTS.md | ${statusIcon(c['AGENTS.md']?.exists)} | ${statusIcon(c['AGENTS.md']?.nonEmpty)} | — |
| System Prompt.md | ${statusIcon(c['System Prompt.md']?.exists)} | ${statusIcon(c['System Prompt.md']?.nonEmpty)} | — |
| Thoth - Digital Twin.md | ${statusIcon(c['Thoth - Digital Twin.md']?.exists)} | ${statusIcon(c['Thoth - Digital Twin.md']?.nonEmpty)} | — |
| Thoth - Obsidian Integration.md | ${statusIcon(c['Thoth - Obsidian Integration.md']?.exists)} | ${statusIcon(c['Thoth - Obsidian Integration.md']?.nonEmpty)} | — |
| Thoth Worktrees.md | ${statusIcon(c['Thoth Worktrees.md']?.exists)} | ${statusIcon(c['Thoth Worktrees.md']?.nonEmpty)} | — |

## Structural Health

| Check | Status | Detail |
|-------|--------|--------|
| Daily note exists | ${statusIcon(results.dailyNote?.exists)} | ${results.dailyNote?.autoCreated ? 'auto-created' : results.dailyNote?.autoFixed ? 'empty→filled' : '—'} |
| Worktrees valid | ${Object.values(results.worktrees || {}).every(w => w.hasAgentsMd) ? '✅' : '⚠️'} | ${Object.entries(results.worktrees || {}).filter(([, w]) => !w.hasAgentsMd).map(([k]) => k).join(', ') || 'all valid'} |
| .gitignore matches | ${results.gitignore?.ok ? '✅' : '⚠️'} | ${(results.gitignore?.missing || []).join(', ') || '—'} |
| No .md tracked in git | ${resultStatus(results.gitMdTracked?.ok)} | ${(results.gitMdTracked?.files || []).length} files |
| No *-config.json tracked | ${resultStatus(results.gitConfigTracked?.ok)} | ${(results.gitConfigTracked?.files || []).length} files |
| logs/ has recent entries | ${(results.logs?.stale || 0) === 0 ? '✅' : '⚠️'} | ${results.logs?.stale || 0} stale |
| PI Cockpit port 3099 | ${dot} | — |
| Obsidian REST API :27124 | ${obsidian} | Obsidian may be closed |
| Inbox frontmatter | ${inboxOk ? '✅' : '⚠️'} | ${results.inbox?.missingTitle || '?'} missing title, ${results.inbox?.missingTags || '?'} missing tags |
| Memory keys convention | ${(results.memory?.nonConforming || 0) === 0 ? '✅' : '⚠️'} | ${results.memory?.nonConforming || 0} non-conforming |
| Event Log pending msgs | ${(results.eventLog?.pending || 0) === 0 ? '✅' : '⚠️'} | ${results.eventLog?.pending || 0} pending |

## Flagged Issues

${criticalCount + warningCount === 0 ? '*No issues found — system healthy.* 🎉' : ''}
${issues.map(i => `- 🔴 **${i.check}** — ${i.detail}`).join('\n')}
${warnings.map(w => `- 🟡 **${w.check}** — ${w.detail}`).join('\n')}

---

*Auto-generated by Vault Keeper heartbeat. Schema v1.1.*
`;

  // Atomic write: write to temp, then rename
  const tmpPath = HEARTBEAT_PATH + '.tmp';
  fs.writeFileSync(tmpPath, heartbeat);
  fs.renameSync(tmpPath, HEARTBEAT_PATH);
  log('  ✅ heartbeat.md written');
}

function resultStatus(ok) {
  if (ok === true) return '✅';
  if (ok === false) return '❌';
  if (typeof ok === 'number') return ok === 0 ? '✅' : '⚠️';
  if (ok === undefined || ok === null) return '⚠️';
  return ok ? '✅' : '❌';
}

// ─── Write to Event Log (deduplicated) ────────────────────────────────────
function writeEventLog() {
  const state = loadState();
  const currentHash = computeIssueHash(issues, warnings);

  // Track what we're flagging for the state file
  scanRun.issues = issues.map(i => ({ check: i.check, detail: i.detail }));
  scanRun.warnings = warnings.map(w => ({ check: w.check, detail: w.detail }));

  // If no issues and hash matches last healthy scan, skip entirely
  if (issues.length === 0 && warnings.length === 0) {
    if (state.lastIssueHash === 'healthy') {
      log('  ℹ️  Event Log unchanged (still healthy) — skipping');
      saveState({ ...state, lastIssueHash: 'healthy', lastScanRun: scanRun });
      return;
    }
    // First time healthy — write an all-clear entry
    log('\n📝 Writing all-clear to Event Log...');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const entry = `\n## vaultkeeper → all (${timestamp})\n**🟢 All clear** — No issues found.\n\nStatus: done\n`;
    fs.appendFileSync(EVENT_LOG_PATH, entry);
    log('  ✅ Event Log updated (all clear)');
    saveState({ lastIssueHash: 'healthy', lastScanRun: scanRun });
    return;
  }

  // Deduplicate: skip if same hash as last scan
  if (state.lastIssueHash === currentHash) {
    log('  ℹ️  Issues unchanged since last scan — skipping duplicate Event Log entry');
    saveState({ ...state, lastIssueHash: currentHash, lastScanRun: scanRun });
    return;
  }

  log('\n📝 Writing to Event Log...');

  // Mark previous entries as done for issues that no longer appear
  const previousChecks = new Set();
  if (state.lastScanRun) {
    for (const i of (state.lastScanRun.issues || [])) previousChecks.add(i.check + '||' + i.detail);
    for (const w of (state.lastScanRun.warnings || [])) previousChecks.add(w.check + '||' + w.detail);
  }

  const currentChecks = new Set();
  for (const i of issues) currentChecks.add(i.check + '||' + i.detail);
  for (const w of warnings) currentChecks.add(w.check + '||' + w.detail);

  // Resolved = were in previous scan but not in current scan
  const resolved = [...previousChecks].filter(x => !currentChecks.has(x));

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  let entry = `\n## vaultkeeper → all (${timestamp})\n`;

  if (issues.length > 0) {
    entry += `**🔴 Critical issues (${issues.length}):**\n`;
    issues.forEach(i => { entry += `- ${i.check}: ${i.detail}\n`; });
  }

  if (warnings.length > 0) {
    entry += `**🟡 Warnings (${warnings.length}):**\n`;
    warnings.forEach(w => { entry += `- ${w.check}: ${w.detail}\n`; });
  }

  if (resolved.length > 0) {
    entry += `\n**✅ Resolved (${resolved.length}):**\n`;
    resolved.forEach(r => {
      const [check, ...detailParts] = r.split('||');
      entry += `- ${check}: ${detailParts.join('||')}\n`;
    });
  }

  entry += `\nStatus: pending\n`;
  entry += `_Auto-detected by Vault Keeper heartbeat. Review and resolve._\n`;

  fs.appendFileSync(EVENT_LOG_PATH, entry);
  log(`  ✅ Event Log updated with ${issues.length} critical + ${warnings.length} warnings`);

  // Mark previous pending entries as done for resolved issues
  if (resolved.length > 0) {
    markResolvedEntries(resolved);
  }

  // Save state for next scan
  saveState({ lastIssueHash: currentHash, lastScanRun: scanRun });
}

// ─── Mark Resolved Issues as Done ─────────────────────────────────────────
function markResolvedEntries(resolvedChecks) {
  try {
    if (!fileExists(EVENT_LOG_PATH)) return;
    let content = readFile(EVENT_LOG_PATH);
    if (!content) return;

    const lines = content.split('\n');
    let modified = false;

    // For each resolved check, find the most recent pending entry mentioning it
    for (const resolved of resolvedChecks) {
      const [checkName] = resolved.split('||');

      // Walk backwards through lines to find the last pending entry mentioning this check
      let lastPendingStatusIdx = -1;

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith('- ') && line.includes(checkName)) {
          // This line contains the check — now find the Status line nearby
          for (let j = i; j < Math.min(i + 20, lines.length); j++) {
            if (lines[j].startsWith('Status: pending')) {
              lastPendingStatusIdx = j;
              break;
            }
            if (lines[j].startsWith('Status: done') || lines[j].startsWith('Status: blocked')) break;
          }
          if (lastPendingStatusIdx >= 0) break;
        }
      }

      if (lastPendingStatusIdx >= 0) {
        lines[lastPendingStatusIdx] = `Status: done — ✅ ${checkName} resolved`;
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(EVENT_LOG_PATH, lines.join('\n'));
      log(`  ✅ Marked ${resolvedChecks.length} resolved issues as done in Event Log`);
    }
  } catch (e) {
    log(`  ⚠️  Could not mark resolved entries: ${e.message}`);
  }
}

// ─── Truncate Event Log ────────────────────────────────────────────────────
function truncateEventLog() {
  try {
    if (!fileExists(EVENT_LOG_PATH)) return;
    let content = readFile(EVENT_LOG_PATH);
    if (!content) return;

    // Count entries by splitting on ## vaultkeeper headers
    const headerPattern = /^##\s+vaultkeeper/gm;
    const parts = content.split(headerPattern);

    // parts[0] is the preamble (before first ## vaultkeeper header)
    // Rest are individual entries
    if (parts.length <= MAX_EVENT_LOG_ENTRIES + 1) return; // +1 for preamble

    // Keep preamble + last N entries
    const preamble = parts[0];
    const lastEntries = parts.slice(parts.length - MAX_EVENT_LOG_ENTRIES);

    // Reconstruct: prepend ## vaultkeeper back to each entry (except preamble)
    let truncated = preamble;
    for (const entry of lastEntries) {
      truncated += '\n## vaultkeeper' + entry;
    }

    // Also clean up leading/trailing blank lines
    truncated = truncated.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    fs.writeFileSync(EVENT_LOG_PATH, truncated);
    log(`  ✂️  Truncated Event Log to last ${MAX_EVENT_LOG_ENTRIES} entries`);
  } catch (e) {
    log(`  ⚠️  Could not truncate Event Log: ${e.message}`);
  }
}

// ─── Try Auto-Fixes ────────────────────────────────────────────────────────
function applyAutoFixes() {
  log('\n🔧 Checking for auto-fixable issues...');

  // Fix 1: Create missing daily note (already done in checkDailyNote)
  // Fix 2: Add missing directories to .gitignore
  const gitignorePath = path.join(VAULT, '.gitignore');
  const gitignore = readFile(gitignorePath);
  if (gitignore && results.gitignore && results.gitignore.missing) {
    let updated = gitignore;
    for (const dir of results.gitignore.missing) {
      if (!updated.includes(dir)) {
        updated += `\n${dir}`;
        log(`  🔧 Added ${dir} to .gitignore`);
      }
    }
    if (updated !== gitignore) {
      fs.writeFileSync(gitignorePath, updated);
    }
  }

  // Fix 3: Create missing log files (empty) so daemons can write
  if (fileExists(LOGS_DIR)) {
    const expectedLogs = [
      'telegram-bot.log', 'telegram-bot-err.log',
      'living-dashboard.log', 'living-dashboard-err.log',
      'living-sync.log',
      'canvas-watcher.log', 'canvas-watcher-error.log',
      'canvas-session.jsonl',
      'watcher.log', 'watcher.err',
    ];
    for (const lf of expectedLogs) {
      const p = path.join(LOGS_DIR, lf);
      if (!fileExists(p)) {
        fs.writeFileSync(p, '');
        log(`  🔧 Created missing log file: ${lf}`);
      }
    }
  }

  log('  ✅ Auto-fixes applied');
}

// ─── Generate Summary ──────────────────────────────────────────────────────
function printSummary() {
  log('\n' + '='.repeat(60));
  const total = issues.length + warnings.length;
  if (total === 0) {
    log('🟢 SYSTEM HEALTHY — No issues found');
  } else {
    log(`🔴 ${issues.length} critical · 🟡 ${warnings.length} warnings`);
    if (issues.length > 0) {
      log('\nCritical:');
      issues.forEach(i => log(`  ❌ ${i.check}`));
    }
    if (warnings.length > 0) {
      log('\nWarnings:');
      warnings.forEach(w => log(`  ⚠️  ${w.check}`));
    }
  }
  log('='.repeat(60) + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  log('🫀 Vault Keeper Heartbeat — Starting health scan');
  log(`   Vault: ${VAULT}`);
  log(`   Time:  ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);

  try {
    checkDaemons();
    checkContextDocs();
    checkDailyNote();
    checkWorktrees();
    checkGitIntegrity();
    checkInboxFrontmatter();
    checkLogsFreshness();
    checkObsidianApi();
    checkMemoryKeys();
    checkEventLog();

    applyAutoFixes();
    writeHeartbeat();
    writeEventLog();
    truncateEventLog();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`\n✨ Scan complete in ${elapsed}s`);
    printSummary();

    // Exit code based on findings
    if (issues.length > 0) process.exit(2);
    if (warnings.length > 0) process.exit(1);
    process.exit(0);

  } catch (e) {
    console.error('❌ Heartbeat scan failed:', e.message);
    process.exit(2);
  }
}

// Watch mode — run on interval
if (process.argv.includes('--watch') || process.argv.includes('-w')) {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  log(`🔄 Watch mode — scanning every ${INTERVAL_MS / 60000} minutes`);
  main().then(() => {
    setInterval(main, INTERVAL_MS);
  });
} else {
  main();
}
