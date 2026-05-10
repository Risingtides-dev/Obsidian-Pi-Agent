#!/usr/bin/env node
// Source: GitHub
// Uses gh api to pull open PRs, assigned issues, and recent activity.

const { execSync } = require('child_process');

const GH_BIN = '/opt/homebrew/bin/gh';

function ghApi(endpoint, timeoutMs = 10000) {
  try {
    return execSync(`${GH_BIN} api "${endpoint}" --jq '.'`, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: { ...process.env, NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      maxBuffer: 1024 * 1024
    }).trim();
  } catch (e) {
    return null;
  }
}

async function githubSource(config) {
  const maxItems = config.maxItemsPerSection || 8;
  const now = new Date();
  const username = 'Risingtides-dev';

  const results = {
    source: 'github',
    title: 'GitHub',
    icon: '🐙',
    lastSync: now.toISOString(),
    error: null,
    data: {
      openPRs: [],
      assignedIssues: [],
      recentActivity: []
    }
  };

  try {
    // 1. Open PRs authored by user
    const prsJson = ghApi(
      `search/issues?q=type:pr+state:open+author:${username}&sort=updated&order=desc&per_page=${maxItems}`,
      15000
    );

    if (prsJson && prsJson !== 'null') {
      try {
        const parsed = JSON.parse(prsJson);
        const items = parsed.items || [];
        results.data.openPRs = items.slice(0, maxItems).map(pr => {
          const repoName = pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown';
          return {
            number: pr.number,
            title: pr.title,
            repo: repoName,
            url: pr.html_url,
            created: pr.created_at,
            updated: pr.updated_at,
            state: pr.state
          };
        });
      } catch {}
    }

    // 2. Assigned issues (excluding PRs)
    const issuesJson = ghApi(
      `search/issues?q=type:issue+state:open+assignee:${username}&sort=updated&order=desc&per_page=${maxItems}`,
      15000
    );

    if (issuesJson && issuesJson !== 'null') {
      try {
        const parsed = JSON.parse(issuesJson);
        const items = parsed.items || [];
        results.data.assignedIssues = items.slice(0, maxItems).map(i => {
          const repoName = i.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown';
          return {
            number: i.number,
            title: i.title,
            repo: repoName,
            url: i.html_url,
            created: i.created_at,
            updated: i.updated_at
          };
        });
      } catch {}
    }

    // 3. Recent activity (user's events feed — last 30 events)
    const eventsJson = ghApi(
      `users/${username}/events/public?per_page=30`,
      10000
    );

    if (eventsJson && eventsJson !== 'null') {
      try {
        const events = JSON.parse(eventsJson);
        const activity = [];
        const seen = new Set();

        for (const e of events) {
          if (activity.length >= maxItems) break;
          const key = `${e.type}-${e.repo?.name}-${e.payload?.ref || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);

          let description = '';
          switch (e.type) {
            case 'PushEvent':
              const commits = e.payload?.commits || [];
              description = `Pushed ${commits.length} commit${commits.length !== 1 ? 's' : ''}`;
              break;
            case 'PullRequestEvent':
              description = `${e.payload?.action} PR #${e.payload?.pull_request?.number}`;
              break;
            case 'IssuesEvent':
              description = `${e.payload?.action} issue #${e.payload?.issue?.number}`;
              break;
            case 'CreateEvent':
              description = `Created ${e.payload?.ref_type} ${e.payload?.ref || ''}`;
              break;
            case 'WatchEvent':
              description = 'Starred';
              break;
            case 'ForkEvent':
              description = 'Forked';
              break;
            default:
              description = e.type.replace('Event', '');
          }

          activity.push({
            type: e.type,
            description,
            repo: e.repo?.name || 'unknown',
            time: e.created_at
          });
        }

        results.data.recentActivity = activity;
      } catch {}
    }

  } catch (err) {
    results.error = err.message;
  }

  return results;
};

module.exports = githubSource;

// CLI mode for testing
if (require.main === module) {
  const config = require('../living-config.json');
  module.exports(config).then(r => {
    console.log(JSON.stringify(r, null, 2));
  });
}
