# Thoth Vault — Agent Instructions

You are working in the Thoth Obsidian vault. This is both a knowledge base AND a multi-agent platform.

## Architecture

```
~/dev/Thoth/           ← Main vault (Obsidian open here)
├── notes, inbox, etc. ← NOT git-tracked, shared by all worktrees
├── scripts/           ← Git-tracked, versioned per branch
└── Event Log.md       ← Agent communication channel

~/.worktrees/Thoth-*/  ← Worktrees (git branches, code only)
└── scripts/           ← Git-tracked, on different branches
```

## Key Rule: Notes vs Code

- **Notes** (`.md` files in vault folders): NEVER committed. Shared across all worktrees. Read/write directly — no git needed.
- **Code** (`scripts/`): Always committed. Versioned per branch. Worktrees isolate code changes.
- **Context**: `vault_path` always points to `~/dev/Thoth/` (the main vault). Read notes from there, not CWD.

## Writing to the Vault

Always use absolute paths. The main vault is at:

```
/Users/risingtidesdev/dev/Thoth/
```

Save notes to:
- `3-Resources/Inbox/` — captured content (articles, tweets, clips)
- `Daily/YYYY-MM-DD.md` — daily notes
- `1-Projects/` — active project notes
- `Event Log.md` — agent-to-agent messages

Format: `YYYY-MM-DD Title.md` with YAML frontmatter.

## Agent Communication

Use **Event Log.md** for inter-agent messages. Format:

```markdown
## [agent-name] → [target] (YYYY-MM-DD HH:MM)
Message body.
Status: pending | done | blocked
```

This is how agents in different worktrees coordinate. No API, no polling — just markdown on a shared filesystem.

## Git Workflow

- `git checkout -b feature` — create branch for your work
- Only commit files in `scripts/`, `Templates/`, `launchd/`, `package.json`
- Never commit vault content (it's gitignored)
- Push when ready; other agents pull to sync code changes

## Available Context

- `git_status` — current branch + worktree indicator (🔀) + GitHub connection (🐙)
- `vault_path` — path to the main vault (always absolute)
- `current_project` — active project focus
- Scratchpad.md — real-time AI interaction channel

## Plugins / Tools

- Local REST API: `http://localhost:27124`
- Obsidian URI: `obsidian://open?vault=Thoth&file=...`
- DeepSeek V4 Flash: key in `scripts/telegram-config.json`
- Telegram bot: running via launchd as `com.thoth.telegram-bot`
