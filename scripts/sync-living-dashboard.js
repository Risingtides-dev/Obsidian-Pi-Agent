#!/usr/bin/env node
// Sync Living Dashboard orchestrator
// Runs sources in parallel, renders, and writes Living.md atomically.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'living-config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const VAULT = config.vaultPath;
const OUTPUT_PATH = path.join(VAULT, 'Living.md');
const LOG_PATH = path.join(VAULT, 'logs', 'living-sync.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

async function runSource(name, config) {
  const sourceConfig = config.sources[name];
  if (!sourceConfig || !sourceConfig.enabled) {
    return { error: 'disabled', lastSync: null, data: {} };
  }

  const modulePath = path.join(__dirname, 'sources', `${name}.js`);
  if (!fs.existsSync(modulePath)) {
    return { error: 'source module not found', lastSync: null, data: {} };
  }

  const startTime = Date.now();
  try {
    const sourceFn = require(modulePath);
    const timeoutMs = sourceConfig.timeoutMs || 10000;

    // Run with timeout
    const result = await Promise.race([
      sourceFn(config),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);

    const elapsed = Date.now() - startTime;
    log(`  ✓ ${name} — ${elapsed}ms`);
    return result;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    log(`  ✗ ${name} — ${err.message} (${elapsed}ms)`);
    return { source: name, error: err.message, lastSync: new Date().toISOString(), data: {} };
  }
}

async function sync(config) {
  log('🔄 Sync started');

  // Run all enabled sources in parallel
  const sourceNames = Object.keys(config.sources);
  const promises = sourceNames.map(name => runSource(name, config));
  const results = await Promise.all(promises);

  // Map results by source name
  const sourceResults = {};
  sourceNames.forEach((name, i) => {
    sourceResults[name] = results[i];
  });

  // Render
  const render = require('./render');
  const html = await render(sourceResults);

  // Atomic write: write to temp file, then rename
  const tmpPath = OUTPUT_PATH + '.tmp';
  fs.writeFileSync(tmpPath, html, 'utf-8');
  fs.renameSync(tmpPath, OUTPUT_PATH);

  const wiredCount = Object.values(sourceResults).filter(r =>
    r && !r.error
  ).length;

  log(`✅ Sync complete — ${wiredCount}/${sourceNames.length} sources, ${html.length} bytes written`);
}

async function watch(config) {
  const interval = config.refreshIntervalMs || 300000;
  log(`🦉 Living Dashboard watcher started — ${interval / 1000}s interval`);
  log(`📄 Output: ${OUTPUT_PATH}`);

  // Run immediately
  await sync(config);

  // Then on interval
  setInterval(() => sync(config), interval);

  // Keep process alive
  process.on('SIGINT', () => {
    log('👋 Shutting down');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    log('👋 Shutting down');
    process.exit(0);
  });
}

// Main
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--watch') || args.includes('-w')) {
    await watch(config);
  } else if (args.includes('--once') || args.includes('-1')) {
    await sync(config);
  } else {
    // Default: sync once
    await sync(config);
  }
})().catch(err => {
  log(`💥 Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
