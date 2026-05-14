#!/usr/bin/env node
/**
 * Vault Keeper — Orphan Detector
 *
 * Detects orphaned, stale, and misplaced content:
 *   - Memory keys referencing deleted projects/worktrees
 *   - Context keys with stale values
 *   - Stale inbox items (>30 days)
 *   - .md files in wrong root locations
 *   - 0-Inbox/ content flagged for archive
 *
 * Usage:
 *   node scripts/vaultkeeper-orphan-detect.js                  # scan only
 *   node scripts/vaultkeeper-orphan-detect.js --dry-run        # scan, no changes
 *   node scripts/vaultkeeper-orphan-detect.js --archive        # move stale items
 *   node scripts/vaultkeeper-orphan-detect.js --quiet          # suppress stdout
 *
 * Exit codes:
 *   0 = no orphans
 *   1 = warnings (stale items found)
 *   2 = critical (orphaned references to active systems)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────
const VAULT = '/Users/risingtidesdev/dev/Thoth';
const HOME = require('os').homedir();
const MEMORY_DIR = path.join(HOME, '.pi', 'agent', 'extensions', 'thoth', 'memory');
const CONTEXT_DIR = path.join(HOME, '.pi', 'agent', 'extensions', 'thoth', 'context');
const INBOX_DIR = path.join(VAULT, '3-Resources', 'Inbox');
const LEGACY_INBOX_DIR = path.join(VAULT, '0-Inbox');
const ARCHIVE_DIR = path.join(VAULT, '4-Archive', 'Inbox Archive');

const DRY_RUN = process.argv.includes('--dry-run');
const ARCHIVE_MODE = process.argv.includes('--archive');
const QUIET = process.argv.includes('--quiet');

// Known active projects and worktrees
const ACTIVE_PROJECTS = [
  'thoth', 'vaultkeeper', 'pi-cockpit', 'pi-net', 'living-dashboard',
  'telegram-bot', 'scratchpad', 'canvas',
];

const ACTIVE_WORKTREES = [
  'Thoth', 'Thoth-pi-cockpit', 'Thoth-pi-net', 'Thoth-vaultkeeper',
];

// ─── State ─────────────────────────────────────────────────────────────────
const criticalIssues = [];
const warnings = [];
const archiveLog = [];
const results = { memory: {}, context: {}, inbox: {}, legacy: {}, rootFiles: [] };

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg) { if (!QUIET) console.log(msg); }
function warn(msg) { if (!QUIET) console.warn(`⚠️  ${msg}`); }
function err(msg) { console.error(`❌ ${msg}`); }

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

// ─── Check Memory Keys for Stale References ────────────────────────────────
function checkMemoryKeys() {
  log('\n🔍 Checking memory keys for stale references...');

  if (!fileExists(MEMORY_DIR)) {
    warnings.push('Memory directory not found');
    return;
  }

  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
    let scanned = 0;
    let orphaned = 0;

    for (const f of files) {
      const key = f.replace('.json', '');
      scanned++;

      // Check if key references a deleted project
      const projectMatch = key.match(/^project\.(\S+)\./);
      if (projectMatch) {
        const projectName = projectMatch[1];
        if (!ACTIVE_PROJECTS.includes(projectName)) {
          // Check if it's a variant (e.g., pi-cockpit vs cockpit)
          const found = ACTIVE_PROJECTS.some(p => projectName.includes(p) || p.includes(projectName));
          if (!found) {
            orphaned++;
            const content = readFile(path.join(MEMORY_DIR, f));
            const value = content ? JSON.parse(content).value : '?';
            log(`  ⚠️  Stale project reference: ${key} → ${value}`);
            warnings.push(`Memory key "${key}" references possibly inactive project "${projectName}"`);
          }
        }
      }

      // Check for worktree references in values
      try {
        const content = readFile(path.join(MEMORY_DIR, f));
        if (content) {
          const parsed = JSON.parse(content);
          const val = String(parsed.value || '');
          for (const wt of ['mac-feature', 'telegram-v2', 'pi-net-old']) {
            if (val.includes(wt) && !ACTIVE_WORKTREES.some(a => a.includes(wt))) {
              log(`  ⚠️  Stale worktree reference in ${key}: "${wt}"`);
              warnings.push(`Memory key "${key}" references stale worktree "${wt}"`);
              orphaned++;
            }
          }
        }
      } catch {}
    }

    results.memory = { total: scanned, orphaned };
    log(`  ${scanned} keys scanned, ${orphaned} potential orphans`);
  } catch (e) {
    warnings.push(`Could not scan memory keys: ${e.message}`);
  }
}

// ─── Check Context Keys for Stale Values ───────────────────────────────────
function checkContextKeys() {
  log('\n🔍 Checking context keys...');

  if (!fileExists(CONTEXT_DIR)) {
    warnings.push('Context directory not found');
    return;
  }

  try {
    const files = fs.readdirSync(CONTEXT_DIR).filter(f => f.endsWith('.json'));
    let stale = 0;

    for (const f of files) {
      const content = readFile(path.join(CONTEXT_DIR, f));
      if (!content) continue;

      try {
        let value;
        // Context values can be plain strings or JSON strings
        try {
          value = JSON.parse(content);
        } catch {
          value = content;
        }

        const key = f.replace('.json', '');

        // Check for stale worktree/branch references
        if (typeof value === 'string') {
          for (const wt of ['mac-feature', 'telegram-v2']) {
            if (value.includes(wt)) {
              log(`  ⚠️  Context key ${key}: stale reference "${wt}"`);
              warnings.push(`Context "${key}" references stale worktree: ${value}`);
              stale++;
            }
          }
        }
      } catch {}
    }

    results.context = { total: files.length, stale };
    log(`  ${files.length} context keys, ${stale} stale references`);
  } catch (e) {
    warnings.push(`Could not scan context keys: ${e.message}`);
  }
}

// ─── Check Inbox for Stale Items (>30 days) ────────────────────────────────
function checkInboxStale() {
  log('\n🔍 Checking inbox for stale items (>30 days)...');

  const dirs = [
    { path: INBOX_DIR, label: 'Inbox' },
    { path: LEGACY_INBOX_DIR, label: '0-Inbox (legacy)' },
  ];

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const { path: dirPath, label } of dirs) {
    if (!fileExists(dirPath)) {
      log(`  ⚠️  ${label}: directory not found`);
      continue;
    }

    try {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      let stale = 0;

      for (const f of files) {
        const fullPath = path.join(dirPath, f);
        const stat = fs.statSync(fullPath);

        if (now - stat.mtimeMs > thirtyDays) {
          stale++;
          const age = Math.floor((now - stat.mtimeMs) / (24 * 60 * 60 * 1000));
          log(`  ⚠️  Stale (${age}d): ${label}/${f}`);

          const entry = { file: f, source: dirPath, age, label };
          warnings.push(`Stale inbox item (${age}d): ${label}/${f}`);

          if (ARCHIVE_MODE && !DRY_RUN) {
            archiveFile(entry);
          }
        }
      }

      results.inbox[label] = { total: files.length, stale };
      log(`  ${label}: ${files.length} files, ${stale} stale (>30d)`);
    } catch (e) {
      warnings.push(`Could not scan ${label}: ${e.message}`);
    }
  }
}

// ─── Check for .md Files in Wrong Locations ────────────────────────────────
function checkRootFiles() {
  log('\n🔍 Checking for misplaced .md files...');

  // Files that belong in the vault root
  const allowedRoot = new Set([
    'README.md', 'AGENTS.md', 'Scratchpad.md', 'Living.md',
    'Dashboard.md', 'Projects.md', 'Event Log.md', 'heartbeat.md',
    'CLAUDE.md', // Claude Code project instructions
  ]);

  try {
    const rootFiles = fs.readdirSync(VAULT).filter(f => f.endsWith('.md'));

    for (const f of rootFiles) {
      if (allowedRoot.has(f)) continue;

      // Check if it's a known note type
      const knownPrefixes = ['Living', 'Scratchpad', 'Event', 'heartbeat', 'Dashboard', 'Projects'];
      const isKnown = knownPrefixes.some(p => f.startsWith(p));
      if (isKnown) continue;

      log(`  ⚠️  Misplaced .md in root: ${f}`);
      warnings.push(`Misplaced .md file in vault root: ${f}`);
      results.rootFiles.push(f);
    }

    log(`  ${rootFiles.length} root .md files, ${results.rootFiles.length} misplaced`);
  } catch (e) {
    warnings.push(`Could not scan root files: ${e.message}`);
  }
}

// ─── Archive Stale Items ───────────────────────────────────────────────────
function archiveFile(entry) {
  try {
    if (!fileExists(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
      log(`  📁 Created archive directory: ${ARCHIVE_DIR}`);
    }

    const sourcePath = path.join(entry.source, entry.file);
    const destPath = path.join(ARCHIVE_DIR, entry.file);

    // Handle duplicates
    let finalDest = destPath;
    let suffix = 1;
    while (fileExists(finalDest)) {
      const ext = path.extname(entry.file);
      const base = path.basename(entry.file, ext);
      finalDest = path.join(ARCHIVE_DIR, `${base}-${suffix}${ext}`);
      suffix++;
    }

    fs.renameSync(sourcePath, finalDest);
    archiveLog.push({ file: entry.file, from: entry.source, to: finalDest, age: entry.age });
    log(`  📦 Archived: ${entry.label}/${entry.file} → 4-Archive/Inbox Archive/`);
  } catch (e) {
    err(`Failed to archive ${entry.file}: ${e.message}`);
  }
}

// ─── Generate Report ───────────────────────────────────────────────────────
function printReport() {
  log(`\n${'='.repeat(60)}`);
  log('🔍 Orphan Detection Report');
  log(`${'='.repeat(60)}`);

  log(`\nMemory Keys: ${results.memory.total || 0} scanned, ${results.memory.orphaned || 0} orphans`);
  log(`Context Keys: ${results.context.total || 0} scanned, ${results.context.stale || 0} stale`);

  log('\nInbox Items:');
  for (const [label, info] of Object.entries(results.inbox)) {
    const status = info.stale === 0 ? '✅' : '⚠️';
    log(`  ${status} ${label}: ${info.total} files, ${info.stale} stale (>30d)`);
  }

  if (results.rootFiles.length > 0) {
    log(`\nMisplaced root files: ${results.rootFiles.length}`);
    results.rootFiles.forEach(f => log(`  - ${f}`));
  }

  if (archiveLog.length > 0) {
    log(`\n📦 Archived (${archiveLog.length} files):`);
    archiveLog.forEach(a => log(`  - ${a.file} (${a.age}d old)`));
  }

  if (criticalIssues.length > 0) {
    log('\n🔴 Critical:');
    criticalIssues.forEach(i => log(`  - ${i}`));
  }

  if (warnings.length > 0) {
    log('\n🟡 Warnings:');
    warnings.forEach(w => log(`  - ${w}`));
  }

  if (criticalIssues.length === 0 && warnings.length === 0) {
    log('\n✅ No orphans detected.');
  }

  log(`${'='.repeat(60)}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const mode = ARCHIVE_MODE ? (DRY_RUN ? 'DRY RUN + ARCHIVE' : 'LIVE + ARCHIVE') : (DRY_RUN ? 'DRY RUN' : 'SCAN');
  log(`🕵️  Vault Keeper — Orphan Detector (${mode})\n`);

  checkMemoryKeys();
  checkContextKeys();
  checkInboxStale();
  checkRootFiles();

  printReport();

  if (criticalIssues.length > 0) process.exit(2);
  if (warnings.length > 0) process.exit(1);
  process.exit(0);
}

main();
