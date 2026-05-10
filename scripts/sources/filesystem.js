#!/usr/bin/env node
// Source: Filesystem / Vault scanner
// Scans the Thoth vault for active projects, daily note, and recent edits.

const fs = require('fs');
const path = require('path');

async function filesystemSource(config) {
  const vaultPath = config.vaultPath;
  const maxItems = config.maxItemsPerSection || 8;
  const now = new Date();

  const results = {
    source: 'filesystem',
    title: 'Vault',
    icon: '📁',
    lastSync: now.toISOString(),
    error: null,
    data: {
      projects: [],
      dailyNote: null,
      recentFiles: []
    }
  };

  try {
    // 1. Active projects from 1-Projects/
    const projectsDir = path.join(vaultPath, '1-Projects');
    if (fs.existsSync(projectsDir)) {
      const projectFiles = fs.readdirSync(projectsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const fullPath = path.join(projectsDir, f);
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, 'utf-8');

          // Extract status from frontmatter
          let status = 'unknown';
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const fm = fmMatch[1];
            const statusMatch = fm.match(/status:\s*(\S+)/);
            if (statusMatch) status = statusMatch[1];
          }

          const title = f.replace('.md', '');

          return {
            title,
            file: f,
            status,
            modified: stat.mtime.toISOString(),
            size: stat.size
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));

      results.data.projects = projectFiles.slice(0, maxItems);
    }

    // 2. Today's daily note
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyDir = path.join(vaultPath, 'Daily');
    const dailyFile = path.join(dailyDir, `${dateStr}.md`);

    if (fs.existsSync(dailyFile)) {
      const content = fs.readFileSync(dailyFile, 'utf-8');
      const stat = fs.statSync(dailyFile);
      results.data.dailyNote = {
        exists: true,
        file: `${dateStr}.md`,
        modified: stat.mtime.toISOString(),
        size: stat.size,
        hasContent: content.trim().length > 0
      };
    } else {
      results.data.dailyNote = {
        exists: false,
        file: `${dateStr}.md`
      };
    }

    // 3. Recently modified vault files (last 24h, excluding .obsidian, .trash, logs, scripts)
    const recentFiles = [];
    const excludeDirs = new Set(['.obsidian', '.trash', 'logs', 'scripts', '.pi', 'Attachments', 'Templates', '.git']);

    function scanDir(dir, depth = 0) {
      if (depth > 4 || recentFiles.length >= maxItems * 2) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.md') continue;
          if (excludeDirs.has(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.name.endsWith('.md')) {
            const stat = fs.statSync(fullPath);
            const ageMs = now - stat.mtime;
            if (ageMs < 24 * 60 * 60 * 1000) { // last 24h
              recentFiles.push({
                file: path.relative(vaultPath, fullPath),
                modified: stat.mtime.toISOString(),
                ageMinutes: Math.round(ageMs / 60000)
              });
            }
          }
        }
      } catch (e) {
        // skip inaccessible dirs
      }
    }

    scanDir(vaultPath);
    recentFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    results.data.recentFiles = recentFiles.slice(0, maxItems);

  } catch (err) {
    results.error = err.message;
  }

  return results;
};

module.exports = filesystemSource;

// CLI mode for testing
if (require.main === module) {
  const config = require('../living-config.json');
  module.exports(config).then(r => {
    console.log(JSON.stringify(r, null, 2));
  });
}
