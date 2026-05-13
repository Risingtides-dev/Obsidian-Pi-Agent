#!/usr/bin/env node
// Render engine: takes source outputs and generates Living.md HTML

const fs = require('fs');
const path = require('path');
const { timeAgo } = require('./lib/utils');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(isoString) {
  if (!isoString) return '—:—';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function renderSection(sectionClass, kicker, headline, bodyHtml, lastSync) {
  return `
    <div class="section ${sectionClass}">
      <div class="section-kicker">${kicker}</div>
      <div class="section-headline">${headline}</div>
      <div class="section-body">
        ${bodyHtml}
      </div>
      <div class="meta">last sync · ${timeAgo(lastSync)}</div>
    </div>`;
}

function renderVaultSection(fsData) {
  if (fsData.error) {
    return renderSection('sec-fs', 'Vault', 'From the desk: active projects and recent edits.',
      `<p class="error">⚠ ${escapeHtml(fsData.error)}</p>`, fsData.lastSync);
  }

  let html = '';

  // Projects
  if (fsData.data.projects && fsData.data.projects.length > 0) {
    html += '<div class="subhead">Active Projects</div><ul class="item-list">';
    for (const p of fsData.data.projects) {
      const statusDot = p.status === 'active' ? '🟢' : p.status === 'paused' ? '🟡' : '⚪';
      html += `<li>${statusDot} <strong>${escapeHtml(p.title)}</strong> <span class="dim">· edited ${timeAgo(p.modified)}</span></li>`;
    }
    html += '</ul>';
  }

  // Daily note
  if (fsData.data.dailyNote) {
    const dn = fsData.data.dailyNote;
    html += '<div class="subhead">Daily Note</div>';
    if (dn.exists) {
      html += `<p>📝 ${dn.file} ${dn.hasContent ? '<span class="dim">· ' + timeAgo(dn.modified) + '</span>' : '<span class="empty-tag">empty</span>'}</p>`;
    } else {
      html += `<p class="empty">📝 ${dn.file} — not created yet</p>`;
    }
  }

  // Recent files — skip the dashboard itself and scratchpad
  if (fsData.data.recentFiles && fsData.data.recentFiles.length > 0) {
    html += '<div class="subhead">Recently Edited</div><ul class="item-list">';
    const filtered = fsData.data.recentFiles.filter(f =>
      !f.file.includes('Living.md') && !f.file.includes('Scratchpad.md')
    ).slice(0, 5);
    for (const f of filtered) {
      html += `<li>📄 ${escapeHtml(f.file)} <span class="dim">· ${f.ageMinutes}m ago</span></li>`;
    }
    html += '</ul>';
  }

  if (!html) html = '<p class="empty">No vault activity detected.</p>';
  return renderSection('sec-fs', 'Vault', 'From the desk: active projects and recent edits.', html, fsData.lastSync);
}

function renderGitHubSection(ghData) {
  if (ghData.error) {
    return renderSection('sec-gh', 'GitHub', 'Open pull requests and the work in flight.',
      `<p class="error">⚠ ${escapeHtml(ghData.error)}</p>`, ghData.lastSync);
  }

  let html = '';

  // Open PRs
  if (ghData.data.openPRs && ghData.data.openPRs.length > 0) {
    html += '<div class="subhead">Open PRs</div><ul class="item-list">';
    for (const pr of ghData.data.openPRs.slice(0, 5)) {
      html += `<li>🔀 <a href="${escapeHtml(pr.url)}">#${pr.number}</a> ${escapeHtml(pr.title)} <span class="dim">· ${escapeHtml(pr.repo)}</span></li>`;
    }
    html += '</ul>';
  }

  // Assigned issues
  if (ghData.data.assignedIssues && ghData.data.assignedIssues.length > 0) {
    html += '<div class="subhead">Assigned Issues</div><ul class="item-list">';
    for (const i of ghData.data.assignedIssues.slice(0, 5)) {
      html += `<li>🐛 <a href="${escapeHtml(i.url)}">#${i.number}</a> ${escapeHtml(i.title)} <span class="dim">· ${escapeHtml(i.repo)}</span></li>`;
    }
    html += '</ul>';
  }

  // Recent activity
  if (ghData.data.recentActivity && ghData.data.recentActivity.length > 0) {
    html += '<div class="subhead">Recent Activity</div><ul class="item-list">';
    for (const a of ghData.data.recentActivity.slice(0, 5)) {
      const icon = a.type === 'PushEvent' ? '📤' : a.type === 'PullRequestEvent' ? '🔀' :
                   a.type === 'IssuesEvent' ? '🐛' : a.type === 'CreateEvent' ? '✨' : '📌';
      html += `<li>${icon} ${escapeHtml(a.description)} <span class="dim">· ${escapeHtml(a.repo)} · ${timeAgo(a.time)}</span></li>`;
    }
    html += '</ul>';
  }

  if (!html) html = '<p class="empty">No GitHub activity detected.</p>';
  return renderSection('sec-gh', 'GitHub', 'Open pull requests and the work in flight.', html, ghData.lastSync);
}

function renderNotionSection(data) {
  if (!data || data.error) {
    return renderSection('sec-notion', 'Notion', 'Tasks, projects, the running ledger.',
      `<p class="empty">Notion source not wired yet.${data?.error ? ' ⚠ ' + escapeHtml(data.error) : ''}</p>`,
      data?.lastSync || null);
  }
  // placeholder — Claude Code will build this
  return renderSection('sec-notion', 'Notion', 'Tasks, projects, the running ledger.',
    '<p class="empty">Notion source not wired yet.</p>', null);
}

function renderCalendarSection(data) {
  if (!data || data.error) {
    return renderSection('sec-cal', 'Calendar', 'What today is asking of you.',
      `<p class="empty">Calendar source not wired yet.${data?.error ? ' ⚠ ' + escapeHtml(data.error) : ''}</p>`,
      data?.lastSync || null);
  }
  return renderSection('sec-cal', 'Calendar', 'What today is asking of you.',
    '<p class="empty">Calendar source not wired yet.</p>', null);
}

function renderGmailSection(data) {
  if (!data || data.error) {
    return renderSection('sec-mail', 'Gmail', 'Threads waiting on a reply.',
      `<p class="empty">Gmail source not wired yet.${data?.error ? ' ⚠ ' + escapeHtml(data.error) : ''}</p>`,
      data?.lastSync || null);
  }
  return renderSection('sec-mail', 'Gmail', 'Threads waiting on a reply.',
    '<p class="empty">Gmail source not wired yet.</p>', null);
}

function renderHero(sourceResults, wiredCount) {
  const ghData = sourceResults.github;
  const fsData = sourceResults.filesystem;

  let headline = 'Five sources, one lens. The day you\'re walking into.';
  let lede = 'Sources are coming online. This space surfaces what matters.';
  let timelineItems = '';

  // Build hero timeline from wired sources
  const now = new Date();
  const items = [];

  // GitHub — top PR
  if (ghData && !ghData.error && ghData.data.openPRs?.length > 0) {
    const top = ghData.data.openPRs[0];
    items.push({ time: formatTime(top.updated), text: `PR #${top.number}: ${top.title} — ${top.repo}` });
  }

  // Filesystem — top project
  if (fsData && !fsData.error && fsData.data.projects?.length > 0) {
    const top = fsData.data.projects[0];
    items.push({ time: '📁', text: `Active: ${top.title} (${top.status})` });
  }

  // Daily note
  if (fsData && !fsData.error && fsData.data.dailyNote?.exists) {
    items.push({ time: '📝', text: `Daily note: ${fsData.data.dailyNote.file}` });
  }

  if (items.length > 0) {
    headline = `${wiredCount} source${wiredCount !== 1 ? 's' : ''} live. Here's your briefing.`;
    lede = 'Sources are coming online. This space surfaces what matters.';
    timelineItems = items.map(i => `<li><span class="time">${i.time}</span>${escapeHtml(i.text)}</li>`).join('\n');
  }

  // Source status list
  const sources = [
    { key: 'calendar', label: 'Calendar' },
    { key: 'github', label: 'GitHub' },
    { key: 'notion', label: 'Notion' },
    { key: 'gmail', label: 'Gmail' },
    { key: 'filesystem', label: 'Vault' }
  ];

  const sourceList = sources.map(s => {
    const result = sourceResults[s.key];
    const wired = result && !result.error && result.data && (
      (result.data.openPRs?.length > 0) ||
      (result.data.projects?.length > 0) ||
      (result.data.recentActivity?.length > 0) ||
      (result.data.recentFiles?.length > 0) ||
      result.data.events?.length > 0 ||
      result.data.unread?.length > 0 ||
      (result.data.dailyNote?.exists)
    );
    const time = result?.lastSync ? formatTime(result.lastSync) : '—:—';
    const status = result?.error && result.error !== 'disabled' ? '⚠ error' : wired ? 'live' : 'not wired';
    return `<li><span class="time">${time}</span>${s.label} source ${status}</li>`;
  }).join('\n');

  return { headline, lede, sourceList, timelineItems };
}

module.exports = async function render(sourceResults) {
  const now = new Date();
  const wiredCount = Object.values(sourceResults).filter(r =>
    r && !r.error && (
      (r.data?.openPRs?.length > 0) ||
      (r.data?.projects?.length > 0) ||
      (r.data?.recentActivity?.length > 0) ||
      (r.data?.recentFiles?.length > 0) ||
      (r.data?.events?.length > 0) ||
      (r.data?.unread?.length > 0) ||
      (r.data?.dailyNote?.exists)
    )
  ).length;

  const hero = renderHero(sourceResults, wiredCount);

  const vaultHtml = renderVaultSection(sourceResults.filesystem || { error: 'no data', lastSync: null, data: {} });
  const ghHtml = renderGitHubSection(sourceResults.github || { error: 'no data', lastSync: null, data: {} });
  const notionHtml = renderNotionSection(sourceResults.notion || null);
  const calHtml = renderCalendarSection(sourceResults.calendar || null);
  const mailHtml = renderGmailSection(sourceResults.gmail || null);

  const vol = 'I';
  const issue = Math.floor((Date.now() - new Date('2026-05-09').getTime()) / 86400000) + 1;

  return `<!-- thoth:living-dashboard auto-generated; do not edit manually -->
<!-- last-render: ${now.toISOString()} -->
<!-- sources-wired: ${wiredCount} -->

<div class="thoth-dash">

  <div class="mast">
    <div class="mast-title">The <em>Living</em><br/>Dashboard</div>
    <div class="mast-meta">
      Vol. ${vol} · No. ${issue}<br/>
      Last sync — ${formatTime(now.toISOString())}<br/>
      Sources — ${wiredCount} of 5
    </div>
  </div>

  <div class="hero">
    <div class="hero-main">
      <div class="hero-kicker">— Today's Briefing —</div>
      <div class="hero-headline">${hero.headline}</div>
      <div class="hero-lede">${hero.lede}</div>
      ${hero.timelineItems ? `<div class="hero-timeline"><ul>${hero.timelineItems}</ul></div>` : ''}
    </div>
    <div class="hero-side">
      <ul>
        ${hero.sourceList}
      </ul>
    </div>
  </div>

  <div class="columns">
    ${vaultHtml}
    ${ghHtml}
    ${notionHtml}
    ${calHtml}
    ${mailHtml}
  </div>
</div>
`;
};

// CLI mode for testing
if (require.main === module) {
  const filesystemSource = require('./sources/filesystem');
  const githubSource = require('./sources/github');
  const config = require('./living-config.json');

  (async () => {
    const results = {};
    results.filesystem = await filesystemSource(config);
    results.github = await githubSource(config);
    const html = await module.exports(results);
    console.log(html);
  })();
}
