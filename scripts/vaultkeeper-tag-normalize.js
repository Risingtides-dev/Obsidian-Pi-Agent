#!/usr/bin/env node
/**
 * Vault Keeper — Tag Normalizer
 *
 * Scans markdown notes across vault directories and normalizes tags:
 *   - Lowercase conversion
 *   - Kebab-case enforcement (spaces → hyphens)
 *   - YAML format normalization (inline vs list)
 *   - Duplicate removal
 *
 * Usage:
 *   node scripts/vaultkeeper-tag-normalize.js              # scan & fix all
 *   node scripts/vaultkeeper-tag-normalize.js --dry-run    # report only, no changes
 *   node scripts/vaultkeeper-tag-normalize.js --dir 3-Resources/Inbox  # specific dir
 *
 * Exit codes:
 *   0 = clean or fixed
 *   1 = issues found (--dry-run) or errors
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const VAULT = '/Users/risingtidesdev/dev/Thoth';
const DEFAULT_DIRS = [
  '3-Resources/Inbox',
  '1-Projects',
  'Daily',
  '0-Inbox',
];

const DRY_RUN = process.argv.includes('--dry-run');
const DIR_FLAG_IDX = process.argv.indexOf('--dir');
const SCAN_DIRS = DIR_FLAG_IDX >= 0
  ? process.argv.slice(DIR_FLAG_IDX + 1).filter(a => !a.startsWith('--'))
  : DEFAULT_DIRS;

// ─── State ─────────────────────────────────────────────────────────────────
let filesScanned = 0;
let filesFixed = 0;
let issues = [];

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`⚠️  ${msg}`); }

function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeTags(tags) {
  // Input: array of tag strings (any format)
  // Output: deduplicated, lowercase, kebab-case array
  const normalized = new Set();
  for (const tag of tags) {
    const cleaned = toKebabCase(String(tag));
    if (cleaned) normalized.add(cleaned);
  }
  return [...normalized].sort();
}

// ─── YAML Tag Extraction & Replacement ─────────────────────────────────────
function parseTagsFromYAML(content) {
  // Find frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { tags: null, inline: false, rawTags: null, fmStart: 0, fmEnd: 0 };

  const fm = fmMatch[1];
  const fmStart = fmMatch.index;
  const fmEnd = fmStart + fmMatch[0].length;

  // Try inline format: tags: [tag1, tag2, tag3]
  const inlineMatch = fm.match(/^tags:\s*\[(.*?)\]\s*$/m);
  if (inlineMatch) {
    const rawTags = inlineMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    return { tags: rawTags, inline: true, rawTags: inlineMatch[0], fmStart, fmEnd, fm };
  }

  // Try inline space-separated: tags: tag1 tag2 tag3
  const inlineSpaceMatch = fm.match(/^tags:\s+(.+)$/m);
  if (inlineSpaceMatch && !inlineSpaceMatch[1].startsWith('-')) {
    const rawTags = inlineSpaceMatch[1].split(/\s+/).filter(Boolean);
    return { tags: rawTags, inline: true, rawTags: inlineSpaceMatch[0], fmStart, fmEnd, fm };
  }

  // Try YAML list format: tags:\n  - tag1\n  - tag2
  const listBlock = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (listBlock) {
    const rawTags = listBlock[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().replace(/^-\s+/, '').replace(/['"]/g, ''));
    return { tags: rawTags, inline: false, rawTags: listBlock[0], fmStart, fmEnd, fm };
  }

  // Tags key exists but unrecognized format
  if (fm.includes('tags:')) {
    return { tags: [], inline: false, rawTags: null, fmStart, fmEnd, fm, unrecognized: true };
  }

  return { tags: null, inline: false, rawTags: null, fmStart, fmEnd };
}

function normalizeTagYAML(content) {
  const parsed = parseTagsFromYAML(content);
  if (!parsed.tags || parsed.unrecognized) return { changed: false, content, issues: parsed.unrecognized ? ['unrecognized_tags_format'] : [] };

  const fileIssues = [];
  const original = [...parsed.tags];
  const normalized = normalizeTags(parsed.tags);

  // Check for changes
  const needsNormalize = original.some((t, i) => t !== (normalized[i] || ''));
  const needsDedup = original.length !== normalized.length;
  const needsFormatFix = parsed.inline; // We prefer YAML list format

  if (!needsNormalize && !needsDedup && !needsFormatFix) {
    return { changed: false, content, issues: [] };
  }

  // Build new tags YAML
  const newTagsYAML = 'tags:\n' + normalized.map(t => `  - ${t}`).join('\n');

  // Track issues
  if (needsNormalize) {
    const changed = original.filter((t, i) => t !== (normalized[i] || ''));
    fileIssues.push(`normalized: [${changed.join(', ')}] → [${normalized.join(', ')}]`);
  }
  if (needsDedup) fileIssues.push('deduplicated');
  if (needsFormatFix) fileIssues.push('format: inline → yaml-list');

  // Find the tags block in frontmatter and replace
  let newContent;
  if (parsed.inline && parsed.rawTags) {
    // Replace the inline tags line
    const fmBefore = content.substring(0, parsed.fmStart);
    const fmAfter = content.substring(parsed.fmEnd);
    const oldFmLines = parsed.fm.split('\n');
    const newFmLines = oldFmLines.map(line => {
      if (line.trim() === parsed.rawTags.trim()) return ''; // Remove old tags line
      if (line.match(/^tags:/)) return ''; // Remove the tags: [...] line
      return line;
    }).filter(line => line !== ''); // Remove empty lines from removal

    // Rebuild frontmatter with new tags at end
    const newFM = '---\n' + newFmLines.join('\n') + '\n' + newTagsYAML + '\n---';
    newContent = fmBefore + newFM + fmAfter;
  } else {
    // Replace the existing tags block
    const before = content.substring(0, parsed.fmStart);
    const after = content.substring(parsed.fmEnd);
    const fmLines = parsed.fm.split('\n');
    const newFmLines = [];
    let skipTags = false;

    for (const line of fmLines) {
      if (line.trim().startsWith('tags:')) {
        skipTags = true;
        continue;
      }
      if (skipTags) {
        if (line.trim().startsWith('- ') || line.trim().startsWith('  - ')) continue;
        skipTags = false;
      }
      newFmLines.push(line);
    }

    // Remove trailing empty lines before ---
    while (newFmLines.length > 0 && newFmLines[newFmLines.length - 1].trim() === '') {
      newFmLines.pop();
    }

    newContent = before + '---\n' + newFmLines.join('\n') + '\n' + newTagsYAML + '\n---' + after;
  }

  return { changed: true, content: newContent, issues: fileIssues };
}

// ─── Scan Directory ────────────────────────────────────────────────────────
function scanDirectory(dirPath) {
  const fullPath = path.join(VAULT, dirPath);
  if (!fs.existsSync(fullPath)) {
    warn(`Directory not found: ${dirPath}`);
    return;
  }

  log(`\n📁 ${dirPath}`);

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.name.endsWith('.md')) {
          processFile(entryPath, dirPath);
        }
      }
    } catch (e) {
      warn(`Cannot read directory ${dir}: ${e.message}`);
    }
  }

  walk(fullPath);
}

function processFile(filePath, relativeDir) {
  filesScanned++;
  const relative = path.relative(VAULT, filePath);

  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Skip files without frontmatter
    if (!content.startsWith('---')) return;

    const result = normalizeTagYAML(content);

    if (result.changed) {
      const fileIssues = result.issues.join(', ');
      const note = `${relative}: ${fileIssues}`;
      issues.push(note);
      log(`  🔧 ${note}`);

      if (!DRY_RUN) {
        fs.writeFileSync(filePath, result.content, 'utf8');
        filesFixed++;
      }
    }
  } catch (e) {
    warn(`Error processing ${relative}: ${e.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const mode = DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE';
  log(`🏷️  Vault Keeper — Tag Normalizer (${mode})`);
  log(`   Scanning: ${SCAN_DIRS.join(', ')}\n`);

  for (const dir of SCAN_DIRS) {
    scanDirectory(dir);
  }

  log(`\n${'='.repeat(60)}`);
  log(`📊 Files scanned: ${filesScanned}`);
  log(`   Tags fixed:   ${filesFixed}${DRY_RUN ? ' (would fix)' : ''}`);
  log(`   Issues found: ${issues.length}`);
  log(`${'='.repeat(60)}`);

  if (DRY_RUN && issues.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
