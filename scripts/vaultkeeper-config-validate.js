#!/usr/bin/env node
/**
 * Vault Keeper — Config Validator & Context Syncer
 *
 * Validates configuration integrity across all worktrees:
 *   - AGENTS.md existence and content drift detection
 *   - Context doc completeness in 3-Resources/
 *   - LaunchAgent plist drift (source vs loaded)
 *
 * --fix mode: syncs AGENTS.md from main to non-specialized worktrees
 *
 * Usage:
 *   node scripts/vaultkeeper-config-validate.js              # scan only
 *   node scripts/vaultkeeper-config-validate.js --fix        # scan + sync non-specialized
 *   node scripts/vaultkeeper-config-validate.js --quiet      # suppress stdout
 *
 * Exit codes:
 *   0 = all valid
 *   1 = warnings (drift detected)
 *   2 = critical (missing files)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────
const VAULT = '/Users/risingtidesdev/dev/Thoth';
const HOME = require('os').homedir();
const CONTEXT_DIR = path.join(VAULT, '3-Resources');
const LAUNCHD_SOURCE_DIR = path.join(VAULT, 'launchd');
const LAUNCHD_LOADED_DIR = path.join(HOME, 'Library', 'LaunchAgents');

const FIX_MODE = process.argv.includes('--fix');
const QUIET = process.argv.includes('--quiet');

// Worktrees that have specialized AGENTS.md (should NOT be synced)
const SPECIALIZED_WORKTREES = ['vaultkeeper', 'Thoth-vaultkeeper'];

// Required context docs
const REQUIRED_CONTEXT_DOCS = [
  'AGENTS.md',
  'System Prompt.md',
  'Thoth - Digital Twin.md',
  'Thoth - Obsidian Integration.md',
  'Thoth Worktrees.md',
];

// ─── State ─────────────────────────────────────────────────────────────────
const criticalIssues = [];
const warnings = [];
const results = { worktrees: {}, contextDocs: {}, plists: {}, synced: [] };

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg) { if (!QUIET) console.log(msg); }
function warn(msg) { if (!QUIET) console.warn(`⚠️  ${msg}`); }
function err(msg) { console.error(`❌ ${msg}`); }

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function isSpecialized(worktreePath) {
  const name = path.basename(worktreePath);
  return SPECIALIZED_WORKTREES.some(s => name.includes(s));
}

// ─── Check Worktrees ──────────────────────────────────────────────────────
function checkWorktrees() {
  log('\n🔍 Checking worktree AGENTS.md integrity...');

  try {
    const out = execSync('git -C ' + VAULT + ' worktree list', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    const mainAgentsPath = path.join(VAULT, 'AGENTS.md');
    const mainAgents = readFile(mainAgentsPath);

    if (!mainAgents) {
      criticalIssues.push('Main vault AGENTS.md is missing!');
      return;
    }

    const lines = out.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const wtPath = parts[0];
      if (!wtPath) continue;

      const branch = parts.length > 2 ? parts[2].replace(/[\[\]]/g, '') : 'detached';
      const wtName = path.basename(wtPath);
      const specialized = isSpecialized(wtPath);
      const agentsPath = path.join(wtPath, 'AGENTS.md');

      const hasAgents = fileExists(agentsPath);
      const content = hasAgents ? readFile(agentsPath) : null;

      // Check existence
      if (!hasAgents) {
        criticalIssues.push(`Worktree ${wtName} (${branch}): AGENTS.md missing`);
        results.worktrees[wtName] = { branch, exists: false, specialized, drift: null };
        continue;
      }

      // Check content drift vs main (for non-specialized worktrees)
      let drift = null;
      if (!specialized && content !== mainAgents) {
        drift = 'different_from_main';
        warnings.push(`Worktree ${wtName} (${branch}): AGENTS.md differs from main vault`);
      } else if (specialized && content === mainAgents) {
        drift = 'should_be_specialized';
        warnings.push(`Worktree ${wtName} (${branch}): marked as specialized but AGENTS.md matches main`);
      }

      const status = hasAgents && (!drift || drift === 'should_be_specialized') ? '✅' : '⚠️';
      const specLabel = specialized ? ' [SPECIALIZED]' : '';
      const driftLabel = drift ? ` (${drift})` : '';
      log(`  ${status} ${wtName} (${branch})${specLabel}${driftLabel}`);

      results.worktrees[wtName] = { branch, exists: true, specialized, drift, path: wtPath };
    }
  } catch (e) {
    criticalIssues.push(`Could not check worktrees: ${e.message}`);
  }
}

// ─── Check Context Docs ────────────────────────────────────────────────────
function checkContextDocs() {
  log('\n🔍 Checking context docs in 3-Resources/...');

  for (const doc of REQUIRED_CONTEXT_DOCS) {
    const fullPath = path.join(CONTEXT_DIR, doc);
    const exists = fileExists(fullPath);
    const nonEmpty = exists && fs.statSync(fullPath).size > 0;

    results.contextDocs[doc] = { exists, nonEmpty };

    const status = exists && nonEmpty ? '✅' : '❌';
    log(`  ${status} ${doc}`);

    if (!exists) {
      criticalIssues.push(`Context doc missing: ${doc}`);
    } else if (!nonEmpty) {
      criticalIssues.push(`Context doc is empty: ${doc}`);
    }
  }
}

// ─── Check LaunchAgent Plist Drift ─────────────────────────────────────────
function checkPlistDrift() {
  log('\n🔍 Checking LaunchAgent plist drift...');

  if (!fileExists(LAUNCHD_SOURCE_DIR)) {
    warn('Source launchd directory not found');
    return;
  }

  try {
    const sourcePlists = fs.readdirSync(LAUNCHD_SOURCE_DIR).filter(f => f.endsWith('.plist'));

    for (const plistName of sourcePlists) {
      const sourcePath = path.join(LAUNCHD_SOURCE_DIR, plistName);
      const loadedPath = path.join(LAUNCHD_LOADED_DIR, plistName);

      results.plists[plistName] = { sourceExists: true, loadedExists: false, drift: null };

      if (!fileExists(loadedPath)) {
        const label = plistName.replace('.plist', '');
        warnings.push(`Plist ${plistName}: exists in source but not loaded in ~/Library/LaunchAgents/`);
        log(`  ⚠️  ${plistName}: not loaded (source exists)`);
        continue;
      }

      results.plists[plistName].loadedExists = true;

      // Compare content (normalize whitespace)
      const sourceContent = readFile(sourcePath).replace(/\s+/g, ' ').trim();
      const loadedContent = readFile(loadedPath).replace(/\s+/g, ' ').trim();

      if (sourceContent !== loadedContent) {
        results.plists[plistName].drift = 'content_differs';
        warnings.push(`Plist ${plistName}: source differs from loaded copy`);
        log(`  ⚠️  ${plistName}: DRIFT (source ≠ loaded)`);
      } else {
        log(`  ✅ ${plistName}: source matches loaded`);
      }
    }
  } catch (e) {
    warnings.push(`Could not check plist drift: ${e.message}`);
  }
}

// ─── Sync AGENTS.md (--fix mode) ──────────────────────────────────────────
function syncAgentsMd() {
  if (!FIX_MODE) return;

  log('\n🔧 Syncing AGENTS.md to non-specialized worktrees...');

  const mainAgents = readFile(path.join(VAULT, 'AGENTS.md'));
  if (!mainAgents) {
    err('Cannot sync: main AGENTS.md is missing');
    return;
  }

  for (const [wtName, info] of Object.entries(results.worktrees)) {
    if (!info.exists) continue;
    if (info.specialized) {
      log(`  ⏭️  ${wtName}: specialized — skipping sync`);
      continue;
    }
    if (info.drift !== 'different_from_main') {
      log(`  ✅ ${wtName}: already in sync`);
      continue;
    }

    const agentsPath = path.join(info.path, 'AGENTS.md');
    try {
      fs.writeFileSync(agentsPath, mainAgents);
      results.synced.push(wtName);
      log(`  🔧 ${wtName}: synced from main`);
    } catch (e) {
      criticalIssues.push(`Failed to sync ${wtName}: ${e.message}`);
    }
  }

  if (results.synced.length > 0) {
    log(`  ✅ Synced ${results.synced.length} worktree(s)`);
  }
}

// ─── Generate Report ───────────────────────────────────────────────────────
function printReport() {
  log(`\n${'='.repeat(60)}`);
  log('📋 Config Validation Report');
  log(`${'='.repeat(60)}`);

  log('\nWorktrees:');
  for (const [name, info] of Object.entries(results.worktrees)) {
    const status = info.exists && (!info.drift || info.drift === 'should_be_specialized') ? '✅' : '⚠️';
    log(`  ${status} ${name} (${info.branch})${info.specialized ? ' [SPECIALIZED]' : ''}`);
  }

  log('\nContext Docs:');
  for (const [doc, info] of Object.entries(results.contextDocs)) {
    const status = info.exists && info.nonEmpty ? '✅' : '❌';
    log(`  ${status} ${doc}`);
  }

  log('\nLaunchAgent Plists:');
  for (const [name, info] of Object.entries(results.plists)) {
    const status = info.loadedExists && !info.drift ? '✅' : '⚠️';
    const note = !info.loadedExists ? 'not loaded' : info.drift || 'match';
    log(`  ${status} ${name}: ${note}`);
  }

  if (results.synced.length > 0) {
    log(`\n🔧 Synced: ${results.synced.join(', ')}`);
  }

  if (criticalIssues.length > 0) {
    log('\n🔴 Critical:');
    criticalIssues.forEach(i => log(`  - ${i}`));
  }

  if (warnings.length > 0) {
    log('\n🟡 Warnings:');
    warnings.forEach(w => log(`  - ${w}`));
  }

  log(`\n${'='.repeat(60)}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const mode = FIX_MODE ? 'LIVE (syncing)' : 'SCAN ONLY';
  log(`⚙️  Vault Keeper — Config Validator (${mode})\n`);

  checkWorktrees();
  checkContextDocs();
  checkPlistDrift();

  if (FIX_MODE) {
    syncAgentsMd();
  }

  printReport();

  if (criticalIssues.length > 0) process.exit(2);
  if (warnings.length > 0) process.exit(1);
  process.exit(0);
}

main();
