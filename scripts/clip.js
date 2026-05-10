#!/usr/bin/env node
// thoth clip — summarize any URL with DeepSeek V4 Flash and save to vault
// Usage: node scripts/clip.js <url>
//        node scripts/clip.js <url> --folder 2-Areas

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────
const DEEPSEEK_KEY = (() => {
  try { return require('./telegram-config.json').deepseekKey; } catch {}
  try { return require('./living-config.json').deepseekKey; } catch {}
  return process.env.DEEPSEEK_API_KEY || '';
})();
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-v4-flash';
const VAULT_PATH = '/Users/risingtidesdev/dev/Thoth';
const DEFAULT_FOLDER = '3-Resources/Inbox';

// ── Helpers ─────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'ThothClip/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function extractText(html) {
  // Aggressive text extraction — remove scripts, styles, tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to ~8000 chars (DeepSeek V4 Flash has 1M context, but keep it fast)
  if (text.length > 12000) {
    text = text.slice(0, 12000) + '...';
  }
  return text;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match) return match[1].trim();
  return null;
}

async function callDeepSeek(systemPrompt, userMessage) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: 2000
  });

  return new Promise((resolve, reject) => {
    const url = new URL(DEEPSEEK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices?.[0]?.message?.content) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error(json.error?.message || 'No content in response'));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sanitizeFilename(title) {
  return title
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// ── Main ────────────────────────────────────────────────
async function clip(url, folder = DEFAULT_FOLDER) {
  console.log(`🔗 Fetching: ${url}`);

  // 1. Fetch page
  const html = await fetchUrl(url);
  const rawTitle = extractTitle(html) || url;
  const text = extractText(html);

  console.log(`📄 Extracted: ${text.length} chars`);

  // 2. Summarize with DeepSeek V4 Flash
  const systemPrompt = `You are a precise research assistant. Your task is to extract and summarize the key information from a web page.

Output format (use exactly this structure):

---
title: "[article title]"
source: "[url]"
clipped: "[current date]"
tags: [relevant, tags, here]
---

# [Title]

## Summary
[2-3 sentence executive summary]

## Key Points
- [bullet point 1]
- [bullet point 2]
- [bullet point 3]
- [bullet point 4]
- [bullet point 5]

## Notable Quotes
> [important quote if any, otherwise omit this section]

## Why This Matters
[1 sentence on relevance/significance]
`;

  console.log('🤖 Summarizing with DeepSeek V4 Flash...');
  const summary = await callDeepSeek(systemPrompt, `URL: ${url}\nTitle: ${rawTitle}\n\nContent:\n${text}`);

  // 3. Extract title from summary for filename
  let title = rawTitle;
  const titleMatch = summary.match(/^title:\s*"(.+)"$/m);
  if (titleMatch) title = titleMatch[1];

  const filename = sanitizeFilename(title) + '.md';
  const outputDir = path.join(VAULT_PATH, folder);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);

  // 4. Write to vault
  const now = new Date().toISOString().split('T')[0];
  const finalContent = summary
    .replace('[article title]', title)
    .replace('[url]', url)
    .replace('[current date]', now);

  fs.writeFileSync(outputPath, finalContent, 'utf-8');

  console.log(`✅ Saved: ${folder}/${filename}`);
  console.log(`   ${'file://' + outputPath}`);
  return outputPath;
}

// ── CLI ──────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/clip.js <url> [--folder <vault-folder>]');
    console.log('Example: node scripts/clip.js https://example.com/article --folder 2-Areas/AI');
    process.exit(1);
  }

  const url = args[0];
  let folder = DEFAULT_FOLDER;
  const folderIdx = args.indexOf('--folder');
  if (folderIdx !== -1 && args[folderIdx + 1]) {
    folder = args[folderIdx + 1];
  }

  clip(url, folder).catch(err => {
    console.error(`❌ Failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { clip };
