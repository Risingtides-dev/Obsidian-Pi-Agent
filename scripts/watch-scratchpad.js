#!/usr/bin/env node

/**
 * watch-scratchpad.js v2 — Obsidian ↔ {{AGENT_NAME}} bridge
 *
 * Watches Scratchpad.md for user edits. Batches rapid changes
 * (typing in Obsidian), waits for quiet, then spawns `claude -p`
 * for a response. Claude Code uses Anthropic OAuth (separate from
 * pi's DeepSeek) — so this works concurrently with active pi sessions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRATCHPAD = path.join(__dirname, '..', 'Scratchpad.md');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const BATCH_WINDOW_MS = 3000;
const QUIET_PERIOD_MS = 2000;
const MAX_CONTEXT_CHARS = 2000;
const CLAUDE_TIMEOUT_MS = 60_000;

let lastHash = null;
let lastSelfWrittenHash = null;
let batchTimer = null;
let quietTimer = null;
let processing = false;
let claudeProcess = null;

// ── Logging ──────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(LOG_DIR, 'watcher.log'), line + '\n'); } catch {}
}

// ── Hash ────────────────────────────────────────────────────
function hashFile() {
  try { return crypto.createHash('md5').update(fs.readFileSync(SCRATCHPAD, 'utf8')).digest('hex'); }
  catch { return null; }
}

// ── Find separators ────────────────────────────────────────
function findSeparators() {
  const content = fs.readFileSync(SCRATCHPAD, 'utf8');
  const lines = content.split('\n');
  const seps = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') seps.push(i);
  }
  const firstSep = seps.length > 0 ? seps[0] : -1;
  const lastSep = seps.length > 1 ? seps[seps.length - 1] : firstSep;
  return { firstSep, lastSep, allSeps: seps };
}

// ── Extract user content ───────────────────────────────────
function getUserContent() {
  const content = fs.readFileSync(SCRATCHPAD, 'utf8');
  const { firstSep, lastSep, allSeps } = findSeparators();
  if (firstSep === -1) return content.trim();

  const lines = content.split('\n');
  if (allSeps.length === 1) {
    return lines.slice(firstSep + 1).join('\n').trim();
  }
  return lines.slice(firstSep + 1, lastSep).join('\n').trim();
}

// ── Append {{AGENT_NAME}}'s response ────────────────────────────────
function appendResponse(response) {
  let content = fs.readFileSync(SCRATCHPAD, 'utf8');
  if (!content.endsWith('\n')) content += '\n';

  const lastLine = content.trimEnd().split('\n').pop().trim();
  if (lastLine !== '---') {
    fs.appendFileSync(SCRATCHPAD, '\n---\n');
  } else {
    fs.appendFileSync(SCRATCHPAD, '\n');
  }
  fs.appendFileSync(SCRATCHPAD, response + '\n');
  lastSelfWrittenHash = hashFile();
}

// ── Kill Claude child ──────────────────────────────────────
function killClaude() {
  if (claudeProcess && !claudeProcess.killed) {
    try { claudeProcess.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (claudeProcess && !claudeProcess.killed) {
        try { claudeProcess.kill('SIGKILL'); } catch {}
      }
    }, 3000);
    claudeProcess = null;
  }
}

// ── Call Claude CLI ────────────────────────────────────────
function callClaude(userContent) {
  return new Promise((resolve) => {
    // Build prompt: system + user content
    const prompt = `You are {{AGENT_NAME}}, a helpful AI assistant responding in a shared Obsidian scratchpad note.
Be concise, direct, and conversational. Use markdown when helpful.
Keep responses brief — this is a shared scratchpad.
If asked something complex, offer to help and suggest next steps.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

The user wrote this in the scratchpad:
---
${userContent.slice(0, MAX_CONTEXT_CHARS)}${userContent.length > MAX_CONTEXT_CHARS ? '\n...[truncated]...' : ''}
---

Respond directly in the scratchpad.`;

    log(`🤖 Spawning claude -p (${prompt.length} chars)`);

    const proc = spawn('{{HOME_PATH}}/.local/bin/claude', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: process.env.HOME },
      cwd: path.join(require('os').homedir(), 'dev', '{{AGENT_NAME}}'),
    });

    claudeProcess = proc;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      log('⏰ Claude timed out');
      killClaude();
      processing = false;
      resolve(null);
    }, CLAUDE_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      claudeProcess = null;

      if (stderr && !stderr.includes('session') && !stderr.includes('warning')) {
        log(`⚠️  claude stderr: ${stderr.slice(0, 200)}`);
      }

      if (code === 0 && stdout.trim()) {
        log(`✅ Response: ${stdout.trim().length} chars`);
        resolve(stdout.trim());
      } else {
        log(`❌ claude exited ${code}${!stdout.trim() ? ' (empty)' : ''}`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      claudeProcess = null;
      log(`❌ claude spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

// ── Process scratchpad input ────────────────────────────────
async function processInput(userContent) {
  if (processing) { log('⏭️  Already processing'); return null; }
  processing = true;

  log(`📨 User input: ${userContent.length} chars`);
  log(`   Preview: ${userContent.slice(0, 80).replace(/\n/g, ' ')}...`);

  try {
    return await callClaude(userContent);
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    processing = false;
    return null;
  } finally {
    // processing is set to false in callClaude's close handler
  }
}

// ── Handle file change (batched) ───────────────────────────
function handleChange() {
  clearTimeout(quietTimer);
  clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => processBatch(), QUIET_PERIOD_MS);
  }, BATCH_WINDOW_MS);
}

async function processBatch() {
  if (processing) { log('⏭️  Skipping batch (processing)'); return; }

  const currentHash = hashFile();
  if (!currentHash) return;
  if (currentHash === lastSelfWrittenHash) { lastHash = currentHash; return; }
  if (currentHash === lastHash) return;
  lastHash = currentHash;

  // Let file settle
  await new Promise(r => setTimeout(r, 500));

  const userContent = getUserContent();
  if (!userContent || userContent.trim().length === 0) {
    log('⏭️  No user content');
    return;
  }

  const response = await processInput(userContent);
  if (response) {
    appendResponse(response);
    log('📝 Response written');
  }
  processing = false;
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

  log('🦉 {{AGENT_NAME}} Scratchpad Watcher v2 (Claude CLI)');
  log(`📄 Watching: ${SCRATCHPAD}`);
  log(`⏱️  Batch: ${BATCH_WINDOW_MS}ms | Quiet: ${QUIET_PERIOD_MS}ms`);
  log(`🤖 Backend: claude -p (Anthropic OAuth)`);

  lastHash = hashFile();
  log('⏳ Ready');

  const watcher = spawn('/opt/homebrew/bin/fswatch', [
    '--latency', '0.5',
    '--event', 'Updated',
    SCRATCHPAD
  ]);

  watcher.stdout.on('data', () => handleChange());
  watcher.stderr.on('data', (d) => log(`⚠️  fswatch: ${d.toString().trim()}`));
  watcher.on('close', (code) => {
    log(`⚠️  fswatch exited (${code}). Restarting in 2s...`);
    setTimeout(main, 2000);
  });

  let done = false;
  const shutdown = () => {
    if (done) return;
    done = true;
    log('👋 Shutting down');
    clearTimeout(batchTimer);
    clearTimeout(quietTimer);
    killClaude();
    watcher.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1); });
