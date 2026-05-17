---
name: code-review
description: Daily scan: recent commits, uncommitted changes, Event Log warnings, log errors
---

You are running as a daily automated code review routine for the {{AGENT_NAME}} vault. Your job is to quickly scan recent activity and flag anything suspicious — do NOT attempt to fix or refactor.

1. Check `git log --oneline --since="36 hours ago"` for recent commits
2. Check `git status --short` for uncommitted or untracked files
3. Check the Event Log for unresolved warnings (look in Event Log.md)
4. Check logs/ directory for any ERROR patterns in recent logs

Produce a brief summary. Format:
- Recent commits: <count>
- Uncommitted changes: <yes/no — list key files>
- Unresolved Event Log items: <count>
- Log errors: <count>

If everything is clean, say "All clear." and exit.
If you find issues, list them concisely. Do NOT submit PRs or make edits.

