#!/usr/bin/env node

/**
 * watch-canvas.js — Watches Command Center.canvas for inbox changes
 * Updates the response node with the agent's reply.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CANVAS = path.join(__dirname, '..', 'Command Center.canvas');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const SESSION_FILE = path.join(LOG_DIR, 'canvas-session.jsonl');
const BATCH_MS = 3000;
const QUIET_MS = 2000;
const API_TIMEOUT = 60_000;

const DEEPSEEK_KEY = (() => {
  try { return require('./telegram-config.json').deepseekKey; } catch {}
  return process.env.DEEPSEEK_API_KEY || '';
})();
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

let conversation = [];
let lastInboxText = '';
let lastSelfWrittenHash = null;
let processing = false;
let batchTimer = null;
let quietTimer = null;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
  try { fs.appendFileSync(path.join(LOG_DIR, 'canvas-watcher.log'), `[${ts}] ${msg}\n`); } catch {}
}

function loadSession() {
  try {
    const data = fs.readFileSync(SESSION_FILE, 'utf8');
    conversation = data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    log(`📚 Loaded ${conversation.length} canvas messages`);
  } catch { conversation = []; }
}

function saveSession() {
  try {
    fs.writeFileSync(SESSION_FILE, conversation.map(m => JSON.stringify(m)).join('\n') + '\n');
  } catch {}
}

function readCanvas() {
  try {
    return JSON.parse(fs.readFileSync(CANVAS, 'utf8'));
  } catch { return null; }
}

function hashCanvas() {
  try { return crypto.createHash('md5').update(fs.readFileSync(CANVAS, 'utf8')).digest('hex'); } catch { return null; }
}

function getInboxText() {
  const canvas = readCanvas();
  if (!canvas?.nodes) return '';
  const inbox = canvas.nodes.find(n => n.id === 'agent-inbox');
  return inbox?.text?.trim() || '';
}

function updateResponse(text) {
  const canvas = readCanvas();
  if (!canvas?.nodes) return false;

  const node = canvas.nodes.find(n => n.id === 'agent-response');
  if (!node) return false;

  // Preserve heading, replace body
  const lines = text.split('\n');
  node.text = `# {{AGENT_NAME}}\n\n${lines.join('\n')}`;

  fs.writeFileSync(CANVAS, JSON.stringify(canvas, null, 2));
  lastSelfWrittenHash = hashCanvas();
  return true;
}

async function callAPI(userContent) {
  const system = {
    role: 'system',
    content: `You are {{AGENT_NAME}}, responding in an Obsidian Canvas node. Keep responses concise. Use markdown. The user is {{USER_NAME}}. Be direct and helpful.`
  };

  const messages = [system, ...conversation.slice(-8), { role: 'user', content: userContent }];
  const body = JSON.stringify({ model: MODEL, messages, max_tokens: 800, temperature: 0.7 });

  log(`🤖 Calling DeepSeek (${messages.length} msgs)`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), API_TIMEOUT);
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
    body,
    signal: ctrl.signal,
  });
  clearTimeout(t);

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('Empty response');

  conversation.push({ role: 'user', content: userContent });
  conversation.push({ role: 'assistant', content: reply });
  saveSession();

  return reply;
}

async function processInbox() {
  if (processing) return;
  processing = true;

  const currentText = getInboxText();
  if (!currentText) { processing = false; return; }

  // CHECKBOX TRIGGER: only process when "- [x] Send" is checked
  const hasCheckbox = /- \[x\]\s*Send/i.test(currentText);
  
  if (!hasCheckbox) {
    // Text changed but checkbox not checked — user still typing, just track it
    lastInboxText = currentText;
    processing = false;
    return;
  }

  // Extract just the user's message: strip heading, instructions, checkbox, datestamps
  let message = currentText
    .replace(/^#\s*🗣️\s*Inbox\s*/i, '')   // remove heading
    .replace(/- \[x\]\s*Send\s*/gi, '')      // remove checkbox
    .replace(/\*Type your next.*?\*\n?/gi, '') // remove instruction line
    .replace(/✅\s*\d{4}-\d{2}-\d{2}\n?/g, '') // remove datestamps
    .replace(/\n{3,}/g, '\n\n')               // collapse triple+ newlines
    .trim();

  if (!message || message.length < 2) {
    log('📨 Canvas: checkbox checked but no message yet');
    processing = false;
    return;
  }

  log(`📨 Canvas inbox: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`);

  try {
    const reply = await callAPI(message);
    log(`✅ Reply: ${reply.length} chars`);
    updateResponse(reply);

    // Reset checkbox: [x] → [ ] so user can send again
    const canvas = readCanvas();
    if (canvas) {
      const inbox = canvas.nodes.find(n => n.id === 'agent-inbox');
      if (inbox) {
        inbox.text = inbox.text.replace(
          /- \[x\]\s*Send/i,
          '- [ ] Send\n\n*Type your next message, then check the box.*'
        );
      }
      fs.writeFileSync(CANVAS, JSON.stringify(canvas, null, 2));
      lastSelfWrittenHash = hashCanvas();
    }
    lastInboxText = getInboxText();
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    updateResponse(`# {{AGENT_NAME}}\n\n*(Error: ${err.message.slice(0, 80)})*`);
  }

  processing = false;
}

function handleChange() {
  clearTimeout(quietTimer);
  clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(async () => {
      const h = hashCanvas();
      if (h === lastSelfWrittenHash) return;
      await processInbox();
    }, QUIET_MS);
  }, BATCH_MS);
}

async function main() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  log('🦉 {{AGENT_NAME}} Canvas Watcher');
  log(`📄 Watching: ${CANVAS}`);
  loadSession();
  lastInboxText = getInboxText();
  log('⏳ Ready — watching canvas...');

  const watcher = spawn('/opt/homebrew/bin/fswatch', ['--latency', '0.5', '--event', 'Updated', CANVAS]);
  watcher.stdout.on('data', () => handleChange());
  watcher.stderr.on('data', d => log(`⚠️  fswatch: ${d.toString().trim()}`));
  watcher.on('close', code => { log(`fswatch exit (${code}), restarting...`); setTimeout(main, 2000); });

  process.on('SIGINT', () => { watcher.kill(); process.exit(0); });
  process.on('SIGTERM', () => { watcher.kill(); process.exit(0); });
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1); });
