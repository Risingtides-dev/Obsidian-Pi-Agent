/**
 * TMA Bridge — dead simple static file server for Telegram Mini Apps.
 *
 * Agent writes files to 6-Agent/tma-mini/ in the vault.
 * They're served live at https://{{AGENT_NAME_LOWER}}.{{DOMAIN}}/<path>
 *
 * .html → served directly
 * .md   → auto-rendered to HTML with full styling
 * other → served as raw
 *
 * Philosophy: the agent ships content. The hub just serves it.
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Artifacts live in the vault at 6-Agent/tma-mini/
// From hub/ dir: go up 2 to vault root, then 6-Agent/tma-mini/
const ARTIFACTS_DIR = join(__dirname, "..", "..", "6-Agent", "tma-mini");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".md":   "text/html; charset=utf-8", // rendered
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".txt":  "text/plain; charset=utf-8",
};

// ── Mini markdown renderer (zero dependencies) ──────────
function renderMd(text) {
  let html = text
    // Escape HTML first
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Headers
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold / italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Horizontal rules
    .replace(/^---$/gm, "<hr>")
    // Blockquotes
    .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
    // Unordered lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Tables (simple)
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split("|").filter(c => c.trim()).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ""; // separator row
      const isHeader = match.includes("---");
      const tag = isHeader ? "th" : "td";
      return "<tr>" + cells.map(c => `<${tag}>${c}</${tag}>`).join("") + "</tr>";
    })
    // Wrap tables
    .replace(/(<tr>.*<\/tr>\n?)+/g, "<table>$&</table>")
    // Wrap list items
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    // Paragraphs (double newlines)
    .replace(/\n\n+/g, "</p><p>")
    // Single newlines to <br>
    .replace(/\n/g, "<br>");

  // Wrap in paragraph
  html = "<p>" + html + "</p>";
  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  const title = text.split("\n")[0].replace(/^#+\s*/, "") || "Artifact";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${title}</title>
<style>
  ${BASE_CSS}
</style>
</head>
<body>
  <div style="position:sticky;top:0;z-index:99;display:flex;align-items:center;padding:8px 16px;background:var(--bg);border-bottom:1px solid var(--border, rgba(128,128,128,0.2));font-family:var(--font-sans);font-size:13px;">
    <a href="/" style="color:var(--link);text-decoration:none;font-weight:500;">← {{AGENT_NAME}}</a>
  </div>
  <div class="container">${html}</div>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
    ${THEME_JS}
  </script>
</body>
</html>`;
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1e1e2e;--text:#cdd6f4;--hint:#6c7086;--link:#89b4fa;
  --secondary:#252536;--section-text:#89b4fa;--subtitle:#a6adc8;
  --font-mono:"JetBrains Mono","SF Mono","Fira Code",monospace;
  --font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}
html,body{
  height:100%;font-family:var(--font-sans);font-size:15px;line-height:1.6;
  color:var(--text);background:var(--bg);
  -webkit-font-smoothing:antialiased;
}
.container{max-width:720px;margin:0 auto;padding:20px 16px 40px;}
h1{font-size:24px;font-weight:700;margin:28px 0 14px;padding-bottom:8px;
  border-bottom:1px solid rgba(128,128,128,0.2);}
h1:first-child{margin-top:0;}
h2{font-size:19px;font-weight:700;margin:22px 0 10px;}
h3{font-size:16px;font-weight:600;margin:16px 0 8px;}
h4{font-size:14px;font-weight:600;margin:12px 0 6px;color:var(--subtitle);}
p{margin:8px 0;}
ul,ol{margin:8px 0;padding-left:22px;}
li{margin:4px 0;}
a{color:var(--link);text-decoration:none;}
strong{font-weight:600;}
em{font-style:italic;}
hr{border:none;border-top:1px solid rgba(128,128,128,0.2);margin:20px 0;}
blockquote{margin:12px 0;padding:10px 14px;border-left:3px solid var(--link);
  background:var(--secondary);border-radius:0 6px 6px 0;color:var(--subtitle);}
code{font-family:var(--font-mono);font-size:13px;}
:not(pre)>code{padding:2px 6px;border-radius:4px;background:var(--secondary);color:var(--link);}
pre{margin:14px 0;border-radius:8px;overflow-x:auto;background:var(--secondary);}
pre code{display:block;padding:14px;line-height:1.5;font-size:13px;}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;}
th,td{padding:8px 12px;text-align:left;border:1px solid rgba(128,128,128,0.2);}
th{background:var(--secondary);font-weight:600;color:var(--section-text);}
tr:nth-child(even) td{background:var(--secondary);}
`;

const THEME_JS = `
(function(){
  const tp = tg?.themeParams;
  if (!tp) return;
  const r = document.documentElement.style;
  if(tp.bg_color) r.setProperty('--bg',tp.bg_color);
  if(tp.text_color) r.setProperty('--text',tp.text_color);
  if(tp.hint_color) r.setProperty('--hint',tp.hint_color);
  if(tp.link_color) r.setProperty('--link',tp.link_color);
  if(tp.button_color) r.setProperty('--button',tp.button_color);
  if(tp.secondary_bg_color) r.setProperty('--secondary',tp.secondary_bg_color);
  if(tp.section_header_text_color) r.setProperty('--section-text',tp.section_header_text_color);
  if(tp.subtitle_text_color) r.setProperty('--subtitle',tp.subtitle_text_color);
})();
`;

// ── HTTP handler ────────────────────────────────────────
export async function handleTmaRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let reqPath = url.pathname;

  // Normalize: /, /viewer, /viewer/index → /index.html
  if (reqPath === "/" || reqPath === "/viewer" || reqPath === "/viewer/index") reqPath = "/index.html";
  if (reqPath.startsWith("/tma/")) reqPath = reqPath.slice(4) || "/index.html";

  // ── /list — return directory listing as JSON ───────
  if (reqPath === "/list") {
    try {
      const files = readdirSync(ARTIFACTS_DIR).filter(f => !f.startsWith(".") && f !== "index.html");
      const results = [];
      for (const f of files) {
        const full = join(ARTIFACTS_DIR, f);
        try {
          const st = statSync(full);
          if (st.isFile()) {
            results.push({
              name: f,
              path: f,
              size: st.size,
              modified: st.mtime.toISOString(),
            });
          }
        } catch {}
      }
      results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Resolve file path within artifacts directory
  const filePath = join(ARTIFACTS_DIR, reqPath);

  // Security: keep inside artifacts dir
  if (!filePath.startsWith(ARTIFACTS_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // File not found
  if (!existsSync(filePath)) {
    // Try with .html extension
    const withHtml = filePath + ".html";
    if (existsSync(withHtml)) {
      return serveFile(withHtml, res);
    }
    // Try with .md extension
    const withMd = filePath + ".md";
    if (existsSync(withMd)) {
      return serveMd(withMd, res);
    }

    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;">
<p>Not found: ${escapeHtml(reqPath)}</p>
</body></html>`);
    return;
  }

  // Directory → look for index.html or index.md
  if (statSync(filePath).isDirectory()) {
    const indexHtml = join(filePath, "index.html");
    const indexMd = join(filePath, "index.md");
    if (existsSync(indexHtml)) return serveFile(indexHtml, res);
    if (existsSync(indexMd)) return serveMd(indexMd, res);

    // Show directory listing
    const files = readdirSync(filePath);
    const items = files.map(f => {
      const full = join(filePath, f);
      const isDir = statSync(full).isDirectory();
      return `<li><a href="${url.pathname === "/" ? "" : url.pathname}/${f}">${escapeHtml(f)}${isDir ? "/" : ""}</a></li>`;
    }).join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(reqPath)}</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;color:#cdd6f4;background:#1e1e2e;}
a{color:#89b4fa;text-decoration:none;line-height:1.8;}ul{list-style:none;padding:0;}</style>
</head><body><h1>📂 ${escapeHtml(reqPath)}</h1><ul>${items}</ul></body></html>`);
    return;
  }

  // Serve file
  const ext = extname(filePath).toLowerCase();
  if (ext === ".md") {
    return serveMd(filePath, res);
  }
  return serveFile(filePath, res, basename(filePath) !== "index.html");
}

function serveFile(filePath, res, wrapWithBack = true) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  try {
    let content = readFileSync(filePath);

    // For HTML artifact pages (not the dashboard), inject a back-to-home bar
    if (wrapWithBack && ext === ".html") {
      content = injectBackBar(content.toString());
    }

    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end("Internal error");
  }
}

// ── Inject a minimal back-to-dashboard bar + save button into HTML pages ─
function injectBackBar(html) {
  const backBar = `
<style>
  .vaultkeeper-back-bar {
    position: sticky; top: 0; z-index: 99;
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px;
    background: #fafaf7; border-bottom: 1px solid #0a0a0a;
    font-family: Inter, Helvetica Neue, Helvetica, Arial, sans-serif;
    font-size: 13px;
  }
  .vaultkeeper-back-bar a {
    color: #0a0a0a; text-decoration: none; font-weight: 500;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .vaultkeeper-back-bar a:hover { color: #cc2030; }
  .vaultkeeper-back-bar .vaultkeeper-save-btn {
    background: #0a0a0a; color: #fafaf7; border: none;
    padding: 4px 12px; font-size: 12px; font-family: Inter, Helvetica Neue, Helvetica, Arial, sans-serif;
    font-weight: 500; cursor: pointer; transition: background 0.15s;
  }
  .vaultkeeper-back-bar .vaultkeeper-save-btn:hover { background: #cc2030; }
  @media (prefers-color-scheme: dark) {
    .vaultkeeper-back-bar { background: #0d1117; border-bottom-color: #30363d; }
    .vaultkeeper-back-bar a { color: #e6edf3; }
    .vaultkeeper-back-bar a:hover { color: #f85149; }
    .vaultkeeper-back-bar .vaultkeeper-save-btn { background: #e6edf3; color: #0d1117; }
    .vaultkeeper-back-bar .vaultkeeper-save-btn:hover { background: #f85149; color: #fff; }
  }
</style>
<div class="vaultkeeper-back-bar">
  <a href="/">← {{AGENT_NAME}}</a>
  <button class="vaultkeeper-save-btn" onclick="saveAsMarkdown()">Save as .md</button>
</div>
<script src="https://unpkg.com/turndown@7/dist/turndown.js"></script>
<script>
let __turndownReady = false;
function saveAsMarkdown() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('.vaultkeeper-back-bar, script, style, noscript, link[rel=stylesheet]').forEach(el => el.remove());

  const title = document.title || 'artifact';
  const filename = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'artifact';

  // Use Turndown if loaded, otherwise basic extraction
  let md;
  if (typeof TurndownService !== 'undefined') {
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    md = td.turndown(clone);
  } else {
    const lines = (clone.textContent || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    md = '# ' + title + '\n\n' + lines.join('\n\n');
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename + '.md';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
`;

  // Inject after <body> or <body...>
  if (html.includes("<body")) {
    return html.replace(/(<body[^>]*>)/i, "$1" + backBar);
  }
  // Fallback: prepend to content
  return backBar + html;
}

function serveMd(filePath, res) {
  try {
    const text = readFileSync(filePath, "utf-8");
    const html = renderMd(text);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
  } catch (err) {
    res.writeHead(500);
    res.end("Internal error");
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
