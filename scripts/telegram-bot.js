#!/usr/bin/env node
// Thoth Telegram Bot — captures everything, summarizes, saves to Obsidian

const { Bot } = require('grammy');
const { execSync, spawnSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = require('./telegram-config.json');
const VAULT = CONFIG.vaultPath;
const INBOX = path.join(VAULT, CONFIG.inboxFolder);

// ── Ensure inbox exists ────────────────────────────────
fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(path.join(VAULT, 'Attachments'), { recursive: true });

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
  const filename = `${dateStr} ${safeTitle}.md`;
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
  return { filepath, filename };
}

// ── URL routing ─────────────────────────────────────────
function isYouTube(url) {
  return /(youtube\.com|youtu\.be)/i.test(url);
}

function isTwitter(url) {
  return /(twitter\.com|x\.com)/i.test(url);
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
async function handleVoice(ctx) {
  const file = await ctx.getFile();
  const tmpOgg = `/tmp/thoth-voice-${Date.now()}.ogg`;
  const tmpWav = `/tmp/thoth-voice-${Date.now()}.wav`;

  try {
    // Download voice file
    const url = `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${file.file_path}`;
    const audioData = await fetchUrl(url);
    fs.writeFileSync(tmpOgg, Buffer.from(await fetchRaw(url)));

    // Convert to wav for whisper
    execSync(`ffmpeg -y -i "${tmpOgg}" -ar 16000 -ac 1 "${tmpWav}" 2>/dev/null`, { timeout: 15000 });

    // Transcribe
    const whisperOut = execSync(
      `${CONFIG.whisperBin} "${tmpWav}" --model ${CONFIG.whisperModel} --language ${CONFIG.whisperLanguage} --output_format txt --output_dir /tmp 2>/dev/null`,
      { encoding: 'utf-8', timeout: 60000 }
    );

    // Read transcript
    const txtFile = tmpWav.replace('.wav', '.txt');
    const transcript = fs.existsSync(txtFile) ? fs.readFileSync(txtFile, 'utf-8').trim() : '';

    if (!transcript) throw new Error('No transcript');

    // Summarize
    const systemPrompt = `You clean up and summarize voice notes. If it's a quick thought, make it a clean note. If it's a longer dictation, structure it.`;
    const userPrompt = `Voice transcript:\n${transcript}\n\nTurn this into a clean, structured note. Keep the original meaning but make it readable. Add markdown formatting where helpful.`;

    const summary = await askDeepSeek(systemPrompt, userPrompt, 2000);

    const title = transcript.split(' ').slice(0, 8).join(' ').slice(0, 70);
    const fullContent = `**Original transcript:**\n> ${transcript.slice(0, 300)}${transcript.length > 300 ? '...' : ''}\n\n---\n\n${summary}`;
    const result = saveToVault(title, fullContent, '', ['voice', 'transcript']);

    return `🎙️ **Saved:** ${result.filename}\n\n${summary.slice(0, 1000)}${summary.length > 1000 ? '...' : ''}`;

  } catch (e) {
    throw new Error(`Voice failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(tmpOgg); } catch {}
    try { fs.unlinkSync(tmpWav); } catch {}
    try { fs.unlinkSync(tmpWav.replace('.wav', '.txt')); } catch {}
  }
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

// ── Bot setup ──────────────────────────────────────────
const bot = new Bot(CONFIG.telegramToken);

bot.command('start', async (ctx) => {
  await ctx.reply(
    `🦉 **Thoth Inbox**\n\n` +
    `Send me anything and I'll summarize it and save it to your Obsidian vault:\n\n` +
    `• **Text** — notes, thoughts, ideas\n` +
    `• **URLs** — articles, YouTube, tweets\n` +
    `• **Voice** — transcribed + summarized\n` +
    `• **Photos** — saved with captions\n` +
    `• **Documents** — filed with notes\n\n` +
    `Everything lands in \`3-Resources/Inbox/\``,
    { parse_mode: 'Markdown' }
  );
});

// Main message handler
bot.on('message', async (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  console.log(`📨 [${msg.from?.first_name || '?'}] ${msg.text ? 'text:' + msg.text.slice(0, 50) : msg.voice ? 'voice' : msg.photo ? 'photo' : msg.document ? 'doc' : msg.video ? 'video' : 'other'}`);

  try {
    let response = '';

    // Voice message
    if (msg.voice) {
      await ctx.reply('🎙️ Transcribing...');
      response = await handleVoice(ctx);
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
      // Strip markdown that might break Telegram's parser
      const cleanResponse = response
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/\*([^*]+)\*/g, '$1');
      try {
        await ctx.reply(cleanResponse, { link_preview_options: { is_disabled: true } });
      } catch (replyErr) {
        // Fallback: plain text without any formatting
        console.error('Reply error:', replyErr.message);
        await ctx.reply(cleanResponse.slice(0, 500));
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

bot.start({
  onStart: (me) => console.log(`✅ Bot @${me.username} is live`),
  drop_pending_updates: true
});
