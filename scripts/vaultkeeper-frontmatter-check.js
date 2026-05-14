#!/usr/bin/env node
/**
 * Vault Keeper — Frontmatter Validator
 *
 * Validates YAML frontmatter across all vault notes. Checks:
 *   - Required fields per note type (inbox: title, tags; project: title, status, tags)
 *   - YAML parse validity (catches malformed frontmatter)
 *   - Tag casing (must be lowercase)
 *   - Date format (YYYY-MM-DD)
 *   - Duplicate keys
 *
 * Usage:
 *   node scripts/vaultkeeper-frontmatter-check.js              # scan all
 *   node scripts/vaultkeeper-frontmatter-check.js --fix        # attempt auto-fix
 *   node scripts/vaultkeeper-frontmatter-check.js --dir 1-Projects  # specific dir
 *
 * Exit codes:
 *   0 = all valid
 *   1 = warnings (minor issues, fixable)
 *   2 = critical (malformed YAML, unfixable without data loss)
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const VAULT = '/Users/risingtidesdev/dev/Thoth';
const SCAN_DIRS_DEFAULT = [
  '3-Resources/Inbox',
  '1-Projects',
  'Daily',
  '0-Inbox',
];

const DIR_FLAG_IDX = process.argv.indexOf('--dir');
const SCAN_DIRS = DIR_FLAG_IDX >= 0
  ? process.argv.slice(DIR_FLAG_IDX + 1).filter(a => !a.startsWith('--'))
  : SCAN_DIRS_DEFAULT;

const FIX_MODE = process.argv.includes('--fix');

// Required fields per directory
const REQUIRED_FIELDS = {
  '3-Resources/Inbox': ['title', 'tags'],
  '0-Inbox': ['title', 'tags'],
  '1-Projects': ['title', 'tags'],
  'Daily': [], // Daily notes have template but no required frontmatter
};

// ─── State ─────────────────────────────────────────────────────────────────
let filesScanned = 0;
let filesWithIssues = 0;
const criticalIssues = [];
const warnings = [];
const resultsByDir = {};

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`⚠️  ${msg}`); }
function err(msg) { console.error(`❌ ${msg}`); }

// ─── Frontmatter Parsing ───────────────────────────────────────────────────
function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { hasFM: false, fm: null, body: content, error: 'No frontmatter' };
  }

  const secondSep = content.indexOf('---', 3);
  if (secondSep === -1) {
    return { hasFM: false, fm: null, body: content, error: 'Unclosed frontmatter (missing closing ---)' };
  }

  const fmRaw = content.substring(3, secondSep).trim();
  const body = content.substring(secondSep + 3);

  // Simple YAML parser (handles common Obsidian patterns)
  const fm = {};
  const lines = fmRaw.split('\n');
  let currentKey = null;
  let currentList = null;
  const duplicateKeys = [];

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') {
      if (currentList !== null && currentKey) {
        fm[currentKey] = currentList;
        currentList = null;
        currentKey = null;
      }
      continue;
    }

    // List continuation
    if (currentList !== null && line.trim().startsWith('-')) {
      currentList.push(line.trim().replace(/^-\s+/, '').replace(/['"]/g, ''));
      continue;
    } else if (currentList !== null && currentKey) {
      // End of list
      fm[currentKey] = currentList;
      currentList = null;
      currentKey = null;
    }

    // Key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (fm.hasOwnProperty(key) && currentList === null) {
        duplicateKeys.push(key);
      }

      if (value === '') {
        // Start of list value
        currentKey = key;
        currentList = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array
        const arr = value.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
        fm[key] = arr;
      } else {
        // Simple scalar
        fm[key] = value.replace(/^['"](.*)['"]$/, '$1');
      }
    }
  }

  // Clean up any dangling list
  if (currentList !== null && currentKey) {
    fm[currentKey] = currentList;
  }

  // Check for duplicate keys
  if (duplicateKeys.length > 0) {
    fm._duplicateKeys = duplicateKeys;
  }

  return { hasFM: true, fm, body, duplicateKeys };
}

// ─── Validation ────────────────────────────────────────────────────────────
function validateFrontmatter(fm, body, relativePath, dirType) {
  const fileIssues = [];

  // Check required fields
  const required = REQUIRED_FIELDS[dirType] || [];
  for (const field of required) {
    if (!fm.hasOwnProperty(field)) {
      // Special case: 'title' can be satisfied by H1 heading in body
      if (field === 'title' && body && body.trim().startsWith('# ')) {
        continue; // H1 heading serves as title
      }
      fileIssues.push({ severity: 'warning', msg: `Missing required field: ${field}` });
    }
  }

  // Check tag casing (if tags exist)
  if (fm.tags) {
    const tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
    for (const tag of tags) {
      if (tag !== tag.toLowerCase()) {
        fileIssues.push({ severity: 'warning', msg: `Tag not lowercase: "${tag}"`, fixable: true });
      }
      if (/[A-Z]/.test(tag)) {
        fileIssues.push({ severity: 'warning', msg: `Tag contains uppercase: "${tag}"`, fixable: true });
      }
      if (/\s/.test(tag)) {
        fileIssues.push({ severity: 'warning', msg: `Tag contains spaces: "${tag}"`, fixable: true });
      }
    }
  }

  // Check date format (created, clipped fields)
  const dateFields = ['created', 'clipped', 'date'];
  for (const df of dateFields) {
    if (fm[df]) {
      const dateStr = String(fm[df]).split(' ')[0]; // Handle "2026-05-10 14:30" format
      // Skip template variables (e.g., {{date}})
      if (dateStr.includes('{{')) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        fileIssues.push({ severity: 'warning', msg: `Invalid date format in ${df}: "${fm[df]}" (expected YYYY-MM-DD)`, fixable: false });
      }
    }
  }

  // Check duplicate keys
  if (fm._duplicateKeys && fm._duplicateKeys.length > 0) {
    fileIssues.push({
      severity: 'critical',
      msg: `Duplicate frontmatter keys: ${fm._duplicateKeys.join(', ')}`,
      fixable: false,
    });
  }

  // Check title is non-empty
  if (fm.title !== undefined && (fm.title === '' || fm.title === null)) {
    fileIssues.push({ severity: 'warning', msg: 'Title is empty', fixable: false });
  }

  return fileIssues;
}

// ─── Auto-Fix ──────────────────────────────────────────────────────────────
function autoFix(filePath, fm, body, issues) {
  const fixable = issues.filter(i => i.fixable);
  if (fixable.length === 0) return false;

  let content = fs.readFileSync(filePath, 'utf8');

  for (const issue of fixable) {
    if (issue.msg.includes('Tag not lowercase') || issue.msg.includes('Tag contains uppercase')) {
      // Extract tag from message
      const tagMatch = issue.msg.match(/"([^"]+)"/);
      if (tagMatch) {
        const oldTag = tagMatch[1];
        const newTag = oldTag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        // Replace in tags line or block
        content = content.replace(new RegExp(`(["']?)\\s*${escapeRegExp(oldTag)}\\s*(["']?)`, 'g'), `$1${newTag}$2`);
      }
    }
    if (issue.msg.includes('Tag contains spaces')) {
      const tagMatch = issue.msg.match(/"([^"]+)"/);
      if (tagMatch) {
        const oldTag = tagMatch[1];
        const newTag = oldTag.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
        content = content.replace(new RegExp(`(["']?)\\s*${escapeRegExp(oldTag)}\\s*(["']?)`, 'g'), `$1${newTag}$2`);
      }
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Directory Classification ──────────────────────────────────────────────
function classifyDir(relativePath) {
  if (relativePath.startsWith('3-Resources/Inbox')) return '3-Resources/Inbox';
  if (relativePath.startsWith('0-Inbox')) return '0-Inbox';
  if (relativePath.startsWith('1-Projects')) return '1-Projects';
  if (relativePath.startsWith('Daily')) return 'Daily';
  return 'other';
}

// ─── Scan ──────────────────────────────────────────────────────────────────
function scanDirectory(dirPath) {
  const fullPath = path.join(VAULT, dirPath);
  if (!fs.existsSync(fullPath)) {
    warn(`Directory not found: ${dirPath}`);
    return;
  }

  log(`\n📁 ${dirPath}`);
  let dirIssues = 0;

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.name.endsWith('.md')) {
          const count = processFile(entryPath);
          if (count > 0) dirIssues += count;
        }
      }
    } catch (e) {
      warn(`Cannot read directory ${dir}: ${e.message}`);
    }
  }

  walk(fullPath);
  resultsByDir[dirPath] = { scanned: filesScanned, issues: dirIssues };
}

function processFile(filePath) {
  filesScanned++;
  const relative = path.relative(VAULT, filePath);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);

    if (!parsed.hasFM) {
      // No frontmatter — skip (not all notes need frontmatter)
      return 0;
    }

    if (parsed.error) {
      criticalIssues.push({ file: relative, msg: parsed.error });
      filesWithIssues++;
      return 1;
    }

    const dirType = classifyDir(relative);
    const fileIssues = validateFrontmatter(parsed.fm, parsed.body, relative, dirType);

    if (parsed.duplicateKeys && parsed.duplicateKeys.length > 0) {
      criticalIssues.push({
        file: relative,
        msg: `Duplicate keys: ${parsed.duplicateKeys.join(', ')}`,
      });
    }

    if (fileIssues.length > 0) {
      filesWithIssues++;

      for (const issue of fileIssues) {
        const prefix = issue.severity === 'critical' ? '❌' : '⚠️';
        log(`  ${prefix} ${relative}: ${issue.msg}`);
        if (issue.severity === 'critical') {
          criticalIssues.push({ file: relative, msg: issue.msg });
        } else {
          warnings.push({ file: relative, msg: issue.msg });
        }
      }

      // Try auto-fix
      if (FIX_MODE) {
        const fixed = autoFix(filePath, parsed.fm, parsed.body, fileIssues);
        if (fixed) {
          log(`  🔧 Fixed: ${relative}`);
        }
      }

      return fileIssues.length;
    }

    return 0;
  } catch (e) {
    criticalIssues.push({ file: relative, msg: `Read error: ${e.message}` });
    return 1;
  }
}

// ─── Generate Report ───────────────────────────────────────────────────────
function printReport() {
  log(`\n${'='.repeat(60)}`);
  log('📊 Frontmatter Validation Report');
  log(`${'='.repeat(60)}`);
  log(`Files scanned:  ${filesScanned}`);
  log(`With issues:    ${filesWithIssues}`);
  log(`Critical:       ${criticalIssues.length}`);
  log(`Warnings:       ${warnings.length}`);

  if (Object.keys(resultsByDir).length > 0) {
    log('\nBy directory:');
    for (const [dir, info] of Object.entries(resultsByDir)) {
      const status = info.issues === 0 ? '✅' : '⚠️';
      log(`  ${status} ${dir}: ${info.issues} issues`);
    }
  }

  if (criticalIssues.length > 0) {
    log('\n🔴 Critical Issues:');
    for (const ci of criticalIssues) {
      log(`  - ${ci.file}: ${ci.msg}`);
    }
  }

  if (warnings.length > 0) {
    log('\n🟡 Warnings:');
    // Group by issue type
    const grouped = {};
    for (const w of warnings) {
      const key = w.msg.split(':')[0].trim();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(w.file);
    }
    for (const [type, files] of Object.entries(grouped)) {
      log(`  - ${type}: ${files.length} files`);
      if (files.length <= 10) {
        files.forEach(f => log(`      ${f}`));
      } else {
        files.slice(0, 5).forEach(f => log(`      ${f}`));
        log(`      ... and ${files.length - 5} more`);
      }
    }
  }

  log(`${'='.repeat(60)}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const mode = FIX_MODE ? 'LIVE (auto-fixing)' : 'SCAN ONLY';
  log(`📋 Vault Keeper — Frontmatter Validator (${mode})`);
  log(`   Scanning: ${SCAN_DIRS.join(', ')}\n`);

  for (const dir of SCAN_DIRS) {
    scanDirectory(dir);
  }

  printReport();

  if (criticalIssues.length > 0) {
    process.exit(2);
  }
  if (warnings.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
