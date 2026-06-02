#!/usr/bin/env node
// Thoth Telegram Bot — captures everything, summarizes, saves to Obsidian

const { Bot } = require('grammy');
const { execSync, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { transcribeAudioWithXai } = require('./lib/xai-stt');

const CONFIG = require('./telegram-config.json');
const VAULT = CONFIG.vaultPath;
const INBOX = path.join(VAULT, CONFIG.inboxFolder);
const ATTACHMENTS = path.join(VAULT, 'Attachments');
const VOICE_AUDIO_DIR = path.join(ATTACHMENTS, 'Voice Notes', 'Audio');
const VOICE_TRANSCRIPT_DIR = path.join(ATTACHMENTS, 'Voice Notes', 'Transcripts');
const VOICE_SUMMARIES_DIR = path.join(VAULT, CONFIG.voiceSummariesFolder || CONFIG.inboxFolder || '0-Inbox');
const OBSIDIAN_VAULT_NAME = CONFIG.obsidianVaultName || 'Thoth';
const WATCH_AGENT_BIN = CONFIG.watchAgentBin || '/Users/risingtidesdev/Documents/apple shortcuts/bin/watch-agent';

// ── Ensure inbox exists ────────────────────────────────
fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(ATTACHMENTS, { recursive: true });
fs.mkdirSync(VOICE_AUDIO_DIR, { recursive: true });
fs.mkdirSync(VOICE_TRANSCRIPT_DIR, { recursive: true });
fs.mkdirSync(VOICE_SUMMARIES_DIR, { recursive: true });

// ── DeepSeek API ───────────────────────────────────────
async function askDeepSeek(systemPrompt, userMessage, maxTokens = 2000) {
  const body = JSON.stringify({
    model: CONFIG.deepseekModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: maxTokens
  });

  return new Promise((resolve, reject) => {
    const url = new URL('https://api.deepseek.com/v1/chat/completions');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.deepseekKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch {
          reject(new Error('Parse error'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Save to vault ──────────────────────────────────────
function saveToVault(title, content, source = '', extraTags = []) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '-').slice(0, 70).trim();
  const filename = uniqueFilename(`${dateStr} ${safeTitle}.md`, INBOX);
  const filepath = path.join(INBOX, filename);

  const tags = ['telegram', ...extraTags].join(', ');
  const sourceLine = source ? `\nsource: "${source}"` : '';

  const note = `---
title: "${title.replace(/"/g, '\\"')}"
clipped: "${now.toISOString()}"${sourceLine}
tags: [${tags}]
---

# ${title}

${content}

---
*Captured via Thoth Telegram Bot · ${dateStr}*
`;

  fs.writeFileSync(filepath, note, 'utf-8');
  return { filepath, filename, vaultPath: vaultRelativePath(filepath), obsidianUrl: obsidianUriForPath(filepath) };
}

function vaultRelativePath(filepath) {
  return path.relative(VAULT, filepath).split(path.sep).join('/');
}

function obsidianUriForPath(filepath) {
  const rel = vaultRelativePath(filepath);
  return `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT_NAME)}&file=${encodeURIComponent(rel)}`;
}

function safeFilenamePart(value, fallback = 'audio') {
  return String(value || fallback)
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90)
    .replace(/^-|-$/g, '') || fallback;
}

function escapeYaml(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function makeHtmlResponse(text, extraOptions = {}) {
  return {
    text,
    options: {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extraOptions,
    },
  };
}

function uniqueFilename(filename, directory) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  let candidate = filename;
  let i = 2;
  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${base} ${i}${ext}`;
    i += 1;
  }
  return candidate;
}

function formatNoteLink(result) {
  return `📍 Note: ${result.vaultPath}\n${result.obsidianUrl}`;
}

// ── URL routing ─────────────────────────────────────────
function isYouTube(url) {
  return /(youtube\.com|youtu\.be)/i.test(url);
}

function isTwitter(url) {
  return /(twitter\.com|x\.com)/i.test(url);
}

function isReddit(url) {
  return /(^|\.)reddit\.com/i.test(url);
}

async function handleYouTube(url) {
  // Get video info + captions with yt-dlp
  const tmpDir = '/tmp/thoth-yt';
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Get metadata
    const meta = execSync(
      `yt-dlp --skip-download --print "%(title)s|||%(channel)s|||%(duration)s|||%(webpage_url)s" "${url}"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    
    const [title, channel, duration, webpageUrl] = meta.split('|||');
    const durationMin = Math.round(parseInt(duration || '0') / 60);

    // Get subtitles
    execSync(
      `yt-dlp --skip-download --write-auto-subs --sub-lang en --convert-subs vtt -o "${tmpDir}/%(id)s" "${url}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }
    );

    // Find the VTT file
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.en.vtt'));
    let transcript = '';

    if (files.length > 0) {
      const vttPath = path.join(tmpDir, files[0]);
      let vtt = fs.readFileSync(vttPath, 'utf-8');
      // Strip VTT formatting
      transcript = vtt
        .replace(/WEBVTT.*?\n\n/s, '')
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> .*?\n/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      fs.unlinkSync(vttPath);
    }

    // Cleanup
    try { fs.rmdirSync(tmpDir); } catch {}

    // Summarize with DeepSeek
    const systemPrompt = `You summarize YouTube videos. Be concise and structured.`;
    const userPrompt = `Title: ${title}
Channel: ${channel}
Duration: ~${durationMin} min
${transcript ? `\nTranscript excerpt:\n${transcript.slice(0, 8000)}` : '\n(No transcript available)'}

Provide:
## Summary
2-3 sentence summary

## Key Points
- 3-5 bullet points of the main ideas

## Worth Noting
- Any stats, quotes, or actionable advice`;

    const summary = await askDeepSeek(systemPrompt, userPrompt, 3000);
    
    const fullContent = `**Source:** [${title}](${webpageUrl})\n**Channel:** ${channel} · **Duration:** ~${durationMin} min\n\n${summary}`;
    const result = saveToVault(title, fullContent, webpageUrl, ['youtube', 'video']);

    return `📺 **Saved:** ${result.filename}\n\n${summary.slice(0, 1000)}${summary.length > 1000 ? '...' : ''}`;

  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    throw new Error(`YouTube failed: ${e.message}`);
  }
}

async function handleTwitter(url) {
  // Use vxtwitter API 
  const apiUrl = url.replace(/twitter\.com|x\.com/, 'api.vxtwitter.com')
    .replace(/\/status\//, '/status/');
  
  const jsonStr = await fetchUrl(apiUrl);
  const tweet = JSON.parse(jsonStr);

  let content = tweet.text || tweet.tweet?.text || '(no text)';
  const author = tweet.user_name || tweet.user_screen_name || tweet.tweet?.author?.name || 'Unknown';
  const handle = tweet.user_screen_name || tweet.tweet?.author?.screen_name || '';

  // Extract any URLs from the tweet text for context
  const urls = content.match(/https?:\/\/[^\s]+/g) || [];
  
  // If tweet text is empty or just a URL, try to get the article content
  let articleText = '';
  if (content.trim().length < 50) {
    for (const u of urls) {
      if (u.includes('x.com/i/article') || u.includes('twitter.com/i/article')) {
        try {
          const html = await fetchUrl(u);
          articleText = extractText(html).slice(0, 3000);
        } catch {}
      }
    }
  }

  const fullContent = articleText || content;
  
  const systemPrompt = `Summarize this tweet${articleText ? ' and linked article' : ''} concisely.`;
  const userPrompt = `Author: ${author} (@${handle})\nTweet: ${content.slice(0, 500)}${articleText ? '\n\nArticle content:\n' + articleText : ''}\n\nGive me a 2-3 bullet point summary of the key message. No fluff.`;

  const summary = await askDeepSeek(systemPrompt, userPrompt, 2000);
  
  const title = `Tweet by ${author}: ${content.slice(0, 50)}`;
  const noteContent = `**Author:** ${author} (@${handle})\n**Source:** ${url}\n\n> ${content.slice(0, 300)}\n\n---\n\n${summary}`;
  const result = saveToVault(title, noteContent, url, ['twitter', 'tweet']);

  return `🐦 **Saved:** ${result.filename}\n\n${summary}`;
}

async function handleReddit(url) {
  // Reddit exposes a full JSON view of any thread by appending `.json` to the
  // permalink. data[0] is the post listing, data[1] is the comments tree.
  const cleanUrl = url.split('?')[0].replace(/\/$/, '') + '.json';
  const jsonStr = await fetchUrl(cleanUrl);
  const data = JSON.parse(jsonStr);

  const post = data?.[0]?.data?.children?.[0]?.data || {};
  const title = post.title || 'Reddit thread';
  const author = post.author ? `u/${post.author}` : 'unknown';
  const subreddit = post.subreddit_name_prefixed || (post.subreddit ? `r/${post.subreddit}` : '');
  const selftext = (post.selftext || '').trim();
  const postScore = typeof post.score === 'number' ? post.score : null;

  // Top-level comments only, sorted by score, capped at ~30.
  const commentChildren = data?.[1]?.data?.children || [];
  const comments = commentChildren
    .filter(c => c.kind === 't1' && c.data && c.data.body)
    .map(c => ({ author: c.data.author, body: c.data.body.trim(), score: c.data.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  let md = `# ${title}\n\n`;
  md += `**Subreddit:** ${subreddit} · **Posted by:** ${author}`;
  if (postScore !== null) md += ` · **Score:** ${postScore}`;
  md += `\n\n`;
  if (selftext) md += `## Post\n${selftext}\n\n`;
  if (comments.length) {
    md += `## Top comments\n`;
    for (const c of comments) {
      md += `- **u/${c.author}** (${c.score}): ${c.body.replace(/\n+/g, ' ')}\n`;
    }
  } else {
    md += `_(No top-level comments)_\n`;
  }

  const systemPrompt = `You summarize Reddit threads. Capture the original post's question/claim and the consensus + notable dissent from the comments. Be concise.`;
  const userPrompt = `URL: ${url}\n\n${md.slice(0, 12000)}\n\nProvide:
## Summary
2-3 sentence summary of the post and the discussion

## Key Points
- 3-6 bullets covering the main takeaways and any strong consensus

## Notable Comments
> Surface 1-3 standout comments (omit if none)`;

  const summary = await askDeepSeek(systemPrompt, userPrompt, 3000);
  const fullContent = `**Source:** [${title}](${url})\n**Subreddit:** ${subreddit} · **Posted by:** ${author}\n\n${summary}`;
  const result = saveToVault(title, fullContent, url, ['reddit']);

  return `👽 **Saved:** ${result.filename}\n\n${summary.slice(0, 1000)}${summary.length > 1000 ? '...' : ''}`;
}

async function handleArticle(url) {
  // Generic article handler — fetch, extract, summarize
  try {
    const html = await fetchUrl(url);
    const title = extractTitle(html) || url;
    const text = extractText(html);

    const systemPrompt = `You extract and summarize web articles. Be concise.`;
    const userPrompt = `URL: ${url}\nTitle: ${title}\n\nContent:\n${text.slice(0, 10000)}\n\nProvide:
## Summary
2-3 sentence summary

## Key Points
- 3-5 bullet points

## Notable Quotes
> Any important quotes (omit if none)`;

    const summary = await askDeepSeek(systemPrompt, userPrompt, 3000);
    const fullContent = `**Source:** [${title}](${url})\n\n${summary}`;
    const result = saveToVault(title, fullContent, url, ['article']);

    return `📄 **Saved:** ${result.filename}\n\n${summary.slice(0, 1000)}${summary.length > 1000 ? '...' : ''}`;

  } catch (e) {
    throw new Error(`Article failed: ${e.message}`);
  }
}

async function handleURL(url) {
  if (isYouTube(url)) return handleYouTube(url);
  if (isTwitter(url)) return handleTwitter(url);
  if (isReddit(url)) return handleReddit(url);
  return handleArticle(url);
}

// ── Web fetch helpers ──────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'ThothBot/1.0' },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractText(html) {
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
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 12000 ? text.slice(0, 12000) + '...' : text;
}

// ── Voice / Audio handler ──────────────────────────────
const AUDIO_EXTENSIONS = new Set(['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'webm', 'mp4']);

function isAudioDocument(message) {
  const doc = message?.document;
  if (!doc) return false;
  const mime = (doc.mime_type || '').toLowerCase();
  const ext = (doc.file_name || '').split('.').pop()?.toLowerCase();
  return mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext);
}

function getAudioPayload(message) {
  if (message.voice) {
    return {
      kind: 'voice',
      fileId: message.voice.file_id,
      originalName: 'telegram-voice.ogg',
      mimeType: message.voice.mime_type || 'audio/ogg',
      duration: message.voice.duration,
      extension: 'ogg',
    };
  }

  if (message.audio) {
    const ext = (message.audio.file_name || '').split('.').pop()?.toLowerCase() || 'mp3';
    return {
      kind: 'audio',
      fileId: message.audio.file_id,
      originalName: message.audio.file_name || `telegram-audio.${ext}`,
      mimeType: message.audio.mime_type || 'audio/*',
      duration: message.audio.duration,
      extension: ext,
    };
  }

  if (isAudioDocument(message)) {
    const ext = (message.document.file_name || '').split('.').pop()?.toLowerCase() || 'audio';
    return {
      kind: 'document-audio',
      fileId: message.document.file_id,
      originalName: message.document.file_name || `telegram-audio.${ext}`,
      mimeType: message.document.mime_type || 'audio/*',
      duration: null,
      extension: ext,
    };
  }

  return null;
}

function telegramFileUrl(filePath) {
  return `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${filePath}`;
}

async function downloadTelegramFile(ctx, fileId, destinationPath) {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram did not return a file path');
  const data = await fetchRaw(telegramFileUrl(file.file_path));
  fs.writeFileSync(destinationPath, data);
  return file;
}

function extractTitleFromMarkdown(markdown, fallback) {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1.slice(0, 90);

  const firstSummaryBullet = markdown.match(/^[-*]\s+(.+)$/m)?.[1]?.trim();
  if (firstSummaryBullet) return firstSummaryBullet.split(/[.!?]/)[0].slice(0, 90);

  return fallback.split(/\s+/).slice(0, 10).join(' ').slice(0, 90) || 'Voice note';
}

function stripLeadingH1(markdown) {
  return markdown.replace(/^#\s+.+\n+/, '').trim();
}

async function summarizeVoiceTranscript(transcript, metadata) {
  const systemPrompt = `You convert dictated voice memos into Obsidian-ready Markdown notes.
Preserve intent. Do not invent facts, dates, names, tasks, or decisions.
If something is ambiguous, put it under Open questions.
Return clean Markdown only.`;

  const userPrompt = `Metadata:\n${JSON.stringify(metadata, null, 2)}\n\nTranscript:\n${transcript}\n\nReturn exactly this structure:\n# Concise title\n\n## Summary\n- 3-6 bullets capturing the memo\n\n## Key takeaways\n- Important ideas, references, or context\n\n## Action items\n- [ ] Tasks explicitly implied by the speaker\n\n## Decisions\n- Decisions or commitments; write \"None captured\" if none\n\n## Open questions\n- Ambiguities or follow-ups; write \"None captured\" if none\n\n## Cleaned notes\nA polished, readable version of the memo in the speaker's intent.`;

  const summary = await askDeepSeek(systemPrompt, userPrompt, 3500);
  if (!String(summary || '').trim()) {
    throw new Error('DeepSeek returned an empty summary');
  }
  return summary;
}

function fallbackVoiceSummary(transcript, error) {
  const reason = String(error?.message || error || 'Unknown summarization error').slice(0, 300);
  return `# Voice note transcript

## Summary
- Summary unavailable because DeepSeek summarization failed: ${reason}
- The Grok/xAI transcript was still captured and preserved.

## Key takeaways
- Review the raw transcript below.

## Action items
- [ ] Review this transcript for tasks or follow-ups.

## Decisions
None captured

## Open questions
- Summarization failed; review the transcript manually.

## Cleaned notes
${transcript}`;
}

function saveVoiceSummaryToVault({ title, summary, transcript, metadata, audioRelPath, transcriptRelPath }) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const safeTitle = safeFilenamePart(title, 'Voice note').replace(/-/g, ' ').slice(0, 70).trim();
  const filename = uniqueFilename(`${dateStr} ${safeFilenamePart(safeTitle, 'Voice note')}.md`, VOICE_SUMMARIES_DIR);
  const filepath = path.join(VOICE_SUMMARIES_DIR, filename);
  const summaryTag = metadata.summarizationError ? 'summary-failed' : 'ai-summary';

  const note = `---
title: "${escapeYaml(title)}"
created: "${now.toISOString()}"
source: "telegram"
telegram_chat_id: "${metadata.chatId || ''}"
telegram_message_id: "${metadata.messageId || ''}"
sender: "${escapeYaml(metadata.senderName || '')}"
audio_file: "${escapeYaml(audioRelPath)}"
transcript_file: "${escapeYaml(transcriptRelPath)}"
models:
  transcription: "${escapeYaml(metadata.transcriptionEngine || CONFIG.transcriptionModel || 'xai-stt')}"
  summarization: "${escapeYaml(metadata.summarizationEngine || CONFIG.deepseekModel || 'deepseek')}"
summarization_error: "${escapeYaml(metadata.summarizationError || '')}"
tags: [telegram, voice-note, transcript, ${summaryTag}]
---

# ${title}

${stripLeadingH1(summary)}

---

## Original audio
![[${audioRelPath}]]

## Source files
- Audio: [[${audioRelPath}]]
- Transcript: [[${transcriptRelPath}]]

## Raw transcript
${transcript}

---
*Captured via Thoth Telegram Bot · ${dateStr}*
`;

  fs.writeFileSync(filepath, note, 'utf-8');
  return { filepath, filename, vaultPath: vaultRelativePath(filepath), obsidianUrl: obsidianUriForPath(filepath) };
}

async function handleAudioMessage(ctx) {
  const msg = ctx.message;
  const payload = getAudioPayload(msg);
  if (!payload) throw new Error('No supported audio payload found');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sender = msg.from?.username || msg.from?.first_name || 'telegram';
  const base = `${stamp}-${safeFilenamePart(sender)}-${msg.message_id}`;
  const audioFilename = `${base}.${safeFilenamePart(payload.extension, 'audio')}`;
  const audioPath = path.join(VOICE_AUDIO_DIR, audioFilename);
  const transcriptFilename = `${base}.txt`;
  const transcriptPath = path.join(VOICE_TRANSCRIPT_DIR, transcriptFilename);

  const metadata = {
    kind: payload.kind,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    durationSeconds: payload.duration || null,
    chatId: msg.chat?.id,
    messageId: msg.message_id,
    senderName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || '',
    receivedAt: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };

  try {
    await downloadTelegramFile(ctx, payload.fileId, audioPath);
    fs.writeFileSync(path.join(VOICE_AUDIO_DIR, `${base}.json`), JSON.stringify({ ...metadata, audioFile: vaultRelativePath(audioPath) }, null, 2));

    const transcription = await transcribeAudioWithXai(audioPath, CONFIG);
    const transcript = transcription.transcript;
    fs.writeFileSync(transcriptPath, transcript, 'utf-8');
    fs.writeFileSync(path.join(VOICE_TRANSCRIPT_DIR, `${base}.xai.json`), JSON.stringify(transcription.raw, null, 2));

    const enrichedMetadata = {
      ...metadata,
      transcriptionEngine: transcription.engine,
      transcriptionDurationSeconds: transcription.durationSeconds,
      transcriptionLanguage: transcription.language,
      audioFile: vaultRelativePath(audioPath),
      transcriptFile: vaultRelativePath(transcriptPath),
    };
    let summary;
    let summarizationMetadata;
    try {
      summary = await summarizeVoiceTranscript(transcript, enrichedMetadata);
      summarizationMetadata = { summarizationEngine: CONFIG.deepseekModel || 'deepseek' };
    } catch (error) {
      summary = fallbackVoiceSummary(transcript, error);
      summarizationMetadata = {
        summarizationEngine: 'transcript-only',
        summarizationError: error.message,
      };
    }

    const title = extractTitleFromMarkdown(summary, transcript);
    const result = saveVoiceSummaryToVault({
      title,
      summary,
      transcript,
      metadata: {
        ...enrichedMetadata,
        ...summarizationMetadata,
      },
      audioRelPath: vaultRelativePath(audioPath),
      transcriptRelPath: vaultRelativePath(transcriptPath),
    });

    const preview = stripLeadingH1(summary).slice(0, 1100);
    const html = `🎙️ Saved voice note: <code>${escapeHtml(result.filename)}</code>\n\n` +
      `<a href="${escapeHtmlAttr(result.obsidianUrl)}">Open your note in Obsidian</a>\n` +
      `<code>${escapeHtml(result.vaultPath)}</code>\n\n` +
      `${escapeHtml(preview)}${summary.length > 1100 ? '...' : ''}`;

    return makeHtmlResponse(html);
  } catch (e) {
    try { fs.unlinkSync(audioPath); } catch {}
    try { fs.unlinkSync(transcriptPath); } catch {}
    throw new Error(`Audio failed: ${e.message}`);
  }
}

// Backward-compatible name used by older handler branches.
async function handleVoice(ctx) {
  return handleAudioMessage(ctx);
}

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Text note handler ──────────────────────────────────
async function handleText(text) {
  // If it's just a quick thought, save directly
  // If it's longer, summarize and structure
  if (text.length < 200) {
    const title = text.slice(0, 70);
    const result = saveToVault(title, text, '', ['note', 'quick']);
    return `📝 **Saved:** ${result.filename}`;
  }

  const systemPrompt = `You clean up and structure personal notes. Keep the original voice but make it readable. Add a title suggestion.`;
  const userPrompt = `Note:\n${text.slice(0, 5000)}\n\nClean this up. Suggest a title. Structure into sections if appropriate. Keep it concise.`;

  const summary = await askDeepSeek(systemPrompt, userPrompt, 2000);
  const title = text.split('\n')[0].slice(0, 70);
  const fullContent = `**Original:**\n> ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}\n\n---\n\n${summary}`;
  const result = saveToVault(title, fullContent, '', ['note']);

  return `📝 **Saved:** ${result.filename}\n\n${summary.slice(0, 1000)}${summary.length > 1000 ? '...' : ''}`;
}

// ── Photo handler ──────────────────────────────────────
async function handlePhoto(ctx) {
  try {
    const file = await ctx.getFile();
    const ext = file.file_path?.split('.').pop() || 'jpg';
    const filename = `telegram-${Date.now()}.${ext}`;
    const attachPath = path.join(VAULT, 'Attachments', filename);

    // Download
    const url = `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${file.file_path}`;
    const data = await fetchRaw(url);
    fs.writeFileSync(attachPath, data);

    // Save a note referencing the image
    const caption = ctx.message?.caption || '';
    const title = caption ? caption.slice(0, 70) : `Photo ${new Date().toLocaleString()}`;
    const content = `![[${filename}]]\n\n${caption}`;
    const result = saveToVault(title, content, '', ['photo']);

    return `📸 **Saved:** ${result.filename}\nImage → Attachments/${filename}`;

  } catch (e) {
    throw new Error(`Photo failed: ${e.message}`);
  }
}

// ── Document handler ───────────────────────────────────
async function handleDocument(ctx) {
  try {
    const file = await ctx.getFile();
    const docName = file.file_path?.split('/').pop() || ctx.message?.document?.file_name || 'document';
    const ext = docName.split('.').pop()?.toLowerCase();
    const filename = `telegram-${Date.now()}-${docName}`;
    const attachPath = path.join(VAULT, 'Attachments', filename);

    // Download
    const url = `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${file.file_path}`;
    const data = await fetchRaw(url);
    fs.writeFileSync(attachPath, data);

    const caption = ctx.message?.caption || '';
    const title = caption || docName;
    const content = `**Document:** ${docName}\n\n![[${filename}]]\n\n${caption}`;
    const result = saveToVault(title, content, '', ['document']);

    return `📎 **Saved:** ${result.filename}\nFile → Attachments/${filename}`;

  } catch (e) {
    throw new Error(`Document failed: ${e.message}`);
  }
}

// ── URL extraction from text ───────────────────────────
function extractURLs(text) {
  const regex = /https?:\/\/[^\s]+/g;
  return text.match(regex) || [];
}

// ── Watch Agent command center ─────────────────────────
function encodeBase64(text) {
  return Buffer.from(String(text || ''), 'utf8').toString('base64');
}

function extractWatchAgentJobId(message) {
  const text = [message?.text, message?.caption].filter(Boolean).join('\n');
  const match = text.match(/\bjob:\s*([0-9]{8}-[0-9]{6}-(?:codex|claude)-[A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function runWatchAgent(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(WATCH_AGENT_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message || '').trim();
        reject(new Error(detail || 'watch-agent command failed'));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function handleWatchAgentReply(ctx) {
  const msg = ctx.message;
  if (!msg?.text || !msg.reply_to_message) return false;

  const jobId = extractWatchAgentJobId(msg.reply_to_message);
  if (!jobId) return false;

  const prompt = msg.text.trim();
  if (!prompt) return false;

  if (/^\/?(finalize|finalise|report)(\s|$)/i.test(prompt)) {
    await ctx.reply(`Finalizing Watch Agent job: ${jobId}`, {
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true,
    });

    try {
      const shouldStop = /\bstop\b|\bkill\b|\bclose\b/i.test(prompt);
      const args = [
        'finalize',
        jobId,
        '--telegram-reply-to',
        String(msg.message_id),
      ];
      if (shouldStop) args.push('--stop');
      const output = await runWatchAgent(args, 120000);
      if (output) {
        await ctx.reply(output.slice(0, 1000), {
          reply_to_message_id: msg.message_id,
          allow_sending_without_reply: true,
        });
      }
    } catch (error) {
      await ctx.reply(`Watch Agent finalize failed: ${String(error.message || error).slice(0, 900)}`, {
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true,
      });
    }

    return true;
  }

  if (prompt.startsWith('/')) return false;

  await ctx.reply(`Queued Watch Agent follow-up for job: ${jobId}`, {
    reply_to_message_id: msg.message_id,
    allow_sending_without_reply: true,
  });

  try {
    const output = await runWatchAgent([
      'follow-up',
      '--job-id',
      jobId,
      '--prompt-b64',
      encodeBase64(prompt),
      '--telegram-reply-to',
      String(msg.message_id),
    ]);
    if (output) {
      await ctx.reply(output.slice(0, 1000), {
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true,
      });
    }
  } catch (error) {
    await ctx.reply(`Watch Agent follow-up failed: ${String(error.message || error).slice(0, 900)}`, {
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true,
    });
  }

  return true;
}

async function handleWatchAgentFinalizeCommand(ctx) {
  const msg = ctx.message;
  const prompt = msg?.text?.trim() || '';
  if (!/^\/?(finalize|finalise|report)(@\w+)?(\s|$)/i.test(prompt)) return false;

  const repliedJobId = extractWatchAgentJobId(msg.reply_to_message);
  const explicitJobId = prompt.match(/\b([0-9]{8}-[0-9]{6}-(?:codex|claude)-[A-Za-z0-9_-]+)\b/i)?.[1];
  const jobId = repliedJobId || explicitJobId || null;
  const shouldStop = /\bstop\b|\bkill\b|\bclose\b/i.test(prompt);
  const args = ['finalize'];
  if (jobId) args.push(jobId);
  args.push('--telegram-reply-to', String(msg.message_id));
  if (shouldStop) args.push('--stop');

  await ctx.reply(`Finalizing Watch Agent ${jobId ? `job: ${jobId}` : 'latest job'}`, {
    reply_to_message_id: msg.message_id,
    allow_sending_without_reply: true,
  });

  try {
    const output = await runWatchAgent(args, 120000);
    if (output) {
      await ctx.reply(output.slice(0, 1000), {
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true,
      });
    }
  } catch (error) {
    await ctx.reply(`Watch Agent finalize failed: ${String(error.message || error).slice(0, 900)}`, {
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true,
    });
  }

  return true;
}

// ── Bot setup ──────────────────────────────────────────
const bot = new Bot(CONFIG.telegramToken);

bot.command('start', async (ctx) => {
  await ctx.reply(
    `🦉 **Thoth Inbox**\n\n` +
    `Send me anything and I'll summarize it and save it to your Obsidian vault:\n\n` +
    `• **Text** — notes, thoughts, ideas\n` +
    `• **URLs** — articles, YouTube, tweets\n` +
    `• **Voice/audio** — transcribed, summarized, saved, linked back\n` +
    `• **Photos** — saved with captions\n` +
    `• **Documents** — filed with notes\n\n` +
    `Text/URLs land in \`${CONFIG.inboxFolder}/\`\n` +
    `Voice summaries land in \`${path.relative(VAULT, VOICE_SUMMARIES_DIR).split(path.sep).join('/')}/\``,
    { parse_mode: 'Markdown' }
  );
});

async function registerWatchAgentAlerts(ctx) {
  const chat = ctx.chat;
  if (!chat?.id) {
    await ctx.reply('Could not read this chat ID.');
    return;
  }

  const title = chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || '';
  try {
    const output = await runWatchAgent([
      'register-telegram-chat',
      '--chat-id',
      String(chat.id),
      '--chat-type',
      chat.type || '',
      '--chat-title',
      title,
    ]);
    await ctx.reply(`${output}\n\nWatch Agent reports and PR links will be sent here.`);
  } catch (error) {
    await ctx.reply(`Could not register Watch Agent alerts: ${String(error.message || error).slice(0, 900)}`);
  }
}

bot.command('register_alerts', registerWatchAgentAlerts);
bot.command('resgister_alerts', registerWatchAgentAlerts);
bot.command('registeralerts', registerWatchAgentAlerts);

// Main message handler
bot.on('message', async (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  console.log(`📨 [${msg.from?.first_name || '?'}] ${msg.text ? 'text:' + msg.text.slice(0, 50) : msg.voice ? 'voice' : msg.audio ? 'audio' : isAudioDocument(msg) ? 'audio-doc' : msg.photo ? 'photo' : msg.document ? 'doc' : msg.video ? 'video' : 'other'}`);

  try {
    let response = '';

    if (msg.text && /^\/(?:register_alerts|resgister_alerts|registeralerts)(?:@\w+)?\b/i.test(msg.text.trim())) {
      await registerWatchAgentAlerts(ctx);
      return;
    }

    if (await handleWatchAgentReply(ctx)) {
      return;
    }

    if (await handleWatchAgentFinalizeCommand(ctx)) {
      return;
    }

    if (msg.text && /^\/(start|register_alerts|resgister_alerts|registeralerts)(@\w+)?\b/.test(msg.text.trim())) {
      return;
    }

    if (msg.text && msg.text.trim().startsWith('/')) {
      await ctx.reply('Unknown command. Available: /register_alerts');
      return;
    }

    // Voice message or uploaded audio file
    if (msg.voice || msg.audio || isAudioDocument(msg)) {
      await ctx.reply('🎙️ Transcribing audio, then I’ll summarize it into Obsidian...');
      response = await handleAudioMessage(ctx);
    }
    // Photo
    else if (msg.photo) {
      await ctx.reply('📸 Saving...');
      response = await handlePhoto(ctx);
    }
    // Document
    else if (msg.document) {
      await ctx.reply('📎 Saving...');
      response = await handleDocument(ctx);
    }
    // Video
    else if (msg.video) {
      await ctx.reply('🎬 Processing video...');
      // For now, just save the video reference
      const file = await ctx.getFile();
      const filename = `telegram-${Date.now()}.mp4`;
      const attachPath = path.join(VAULT, 'Attachments', filename);
      const url = `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${file.file_path}`;
      const data = await fetchRaw(url);
      fs.writeFileSync(attachPath, data);

      const caption = msg.caption || 'Video note';
      const result = saveToVault(caption, `![[${filename}]]\n\n${msg.caption || ''}`, '', ['video']);
      response = `🎬 **Saved:** ${result.filename}`;
    }
    // Text message
    else if (msg.text) {
      const text = msg.text;
      const urls = extractURLs(text);

      if (urls.length > 0) {
        await ctx.reply('🔍 Processing...');
        const results = [];
        for (const url of urls) {
          try {
            results.push(await handleURL(url));
          } catch (e) {
            results.push(`❌ ${url}: ${e.message}`);
          }
        }
        response = results.join('\n\n');
      } else {
        response = await handleText(text);
      }
    }

    if (response) {
      const responseText = typeof response === 'string' ? response : response.text;
      const responseOptions = typeof response === 'string'
        ? { link_preview_options: { is_disabled: true } }
        : (response.options || {});

      // Strip markdown that might break Telegram's parser for plain-text responses.
      const cleanResponse = typeof response === 'string'
        ? responseText
          .replace(/\*\*/g, '')
          .replace(/__/g, '')
          .replace(/\*([^*]+)\*/g, '$1')
        : responseText;

      try {
        await ctx.reply(cleanResponse, responseOptions);
      } catch (replyErr) {
        // Fallback: plain text without any formatting
        console.error('Reply error:', replyErr.message);
        const fallback = cleanResponse
          .replace(/<a\s+href="([^"]+)">([^<]+)<\/a>/g, '$2: $1')
          .replace(/<[^>]+>/g, '');
        await ctx.reply(fallback.slice(0, 1000), { link_preview_options: { is_disabled: true } });
      }
    }
  } catch (e) {
    console.error('Handler error:', e.message);
    await ctx.reply(`❌ ${e.message.slice(0, 200)}`).catch(() => {});
  }
});

// Catch grammY errors
bot.catch((err) => {
  console.error('Bot error:', err.message, err.error?.description || '');
});

// ── Start ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason?.message || reason);
});

console.log('🦉 Thoth Telegram Bot starting...');
console.log(`📁 Vault: ${VAULT}`);
console.log(`📥 Inbox: ${INBOX}`);
console.log(`🎙️ Voice summaries: ${VOICE_SUMMARIES_DIR}`);

bot.start({
  onStart: (me) => console.log(`✅ Bot @${me.username} is live`),
  drop_pending_updates: true
});
