# Thoth — Obsidian-Based Development Environment

You are an AI agent working inside **Thoth**, an Obsidian vault that doubles as a development platform. Your IDE is Obsidian. Your filesystem is a vault. Your teammates are other AI agents in parallel worktrees. Your communication channel is a markdown file.

## Why Obsidian as a Dev Environment?

Obsidian watches the filesystem. Write a file → it appears in the UI instantly. This means:

- **Your notes are the filesystem.** There is no database. Every note is a `.md` file on disk.
- **Agents write to the vault directly.** No API calls needed for local operations. Just `fs.writeFileSync()`.
- **Obsidian renders everything.** Markdown, HTML, canvases, Dataview queries — agents can build dashboards, task boards, and structured data views that render natively.
- **Plugins extend the platform.** Local REST API gives HTTP access. Terminal plugin lets you run `pi` and scripts inside Obsidian. Dataview queries notes like a database.

## Architecture: Vault + Worktrees

```
~/dev/Thoth/                    ← MAIN VAULT — Obsidian runs here
│                                  Git-tracked: scripts/, AGENTS.md, README.md
│                                  NOT tracked: all your notes, inbox, projects
│
├── 1-Projects/                 ← Active project notes (Living Dashboard, etc.)
├── 3-Resources/Inbox/          ← All agent-captured content lands here
├── Daily/                      ← Daily notes (2026-05-10.md, etc.)
├── Event Log.md                ← Inter-agent communication channel
├── Scratchpad.md               ← Real-time AI interaction
├── Living.md                   ← Auto-generated dashboard (HTML in MD)
├── scripts/                    ← All agent code (telegram-bot, clipper, sources)
│   ├── telegram-bot.js         ← 24/7 Telegram capture pipeline
│   ├── clip.js                 ← CLI web clipper
│   ├── sync-living-dashboard.js ← 5-min dashboard orchestrator
│   └── sources/                ← Data modules (github, filesystem, etc.)
└── AGENTS.md                   ← THIS FILE — instructions for all agents

~/.worktrees/
└── Thoth-mac-feature/          ← WORKTREE — code only, no notes
│   └── scripts/                ← Same scripts/, different branch
└── Thoth-telegram-v2/          ← Another worktree, another branch
    └── scripts/
```

### The Split

| What | Where | Git? | Shared? |
|------|-------|------|---------|
| Your notes, inbox, projects | Main vault only | ❌ Gitignored | ✅ All agents see the same notes |
| Agent code (scripts/) | Main vault + all worktrees | ✅ Versioned per branch | ❌ Each worktree has its own branch |
| AGENTS.md, README.md | Main vault + all worktrees | ✅ Always tracked | ✅ Same on every branch |
| Event Log.md | Main vault only | ❌ Runtime data | ✅ All agents read/write to same file |
| Obsidian config (.obsidian/) | Main vault only | ❌ Gitignored | N/A — only Obsidian touches this |

### How Notes Are Shared

Every agent, regardless of which worktree it's in, reads and writes notes to the **main vault** at `/Users/risingtidesdev/dev/Thoth/`. This is stored in the `vault_path` context variable.

```
Agent in ~/.worktrees/Thoth-telegram-v2/:
  writes note → /Users/risingtidesdev/dev/Thoth/3-Resources/Inbox/article.md
  Obsidian sees it instantly (filesystem watcher)
  Agent in ~/.worktrees/Thoth-mac-feature/:
    reads note → /Users/risingtidesdev/dev/Thoth/3-Resources/Inbox/article.md
    same file, no sync, no API, no delay
```

This works because:
1. All agents use **absolute paths** to the main vault
2. The vault is on a **local filesystem** (no network latency)
3. Obsidian's file watcher picks up changes in milliseconds
4. No git commit/push/pull needed for notes — just code

### How Worktrees Work

Git worktrees let you have **multiple working directories** from the same repository, each on a different branch. In Thoth, this means:

```bash
# Main vault — Obsidian runs here, on 'main' branch
~/dev/Thoth/

# Worktree — Pi session, on 'telegram-v2' branch
~/.worktrees/Thoth-telegram-v2/

# Worktree — another Pi session, on 'pi-net' branch
~/.worktrees/Thoth-pi-net/
```

Each worktree has its own copy of `scripts/` (on its branch) but **no notes**. The notes only exist in the main vault. This means:

- Two agents can code on different branches simultaneously without conflicts
- Both agents can read/write the same notes without git interference
- `git checkout` in a worktree only affects code, never notes

**Creating a worktree:**
```bash
cd ~/dev/Thoth
wt telegram-v2          # creates ~/.worktrees/Thoth-telegram-v2/ + new branch
cd ~/.worktrees/Thoth-telegram-v2
pi                      # starts Pi session with vault_path context
```

**The `thoth` command** (fzf launcher) shows all worktrees and their Pi sessions:
```bash
thoth                   # browse worktrees, resume past sessions, or start new
```

### Inter-Agent Communication

Use **Event Log.md** in the main vault. One file, append-only, all agents can read/write:

```markdown
## telegram-v2 → pi-net (2026-05-10 16:30)
Built the YouTube caption extractor in scripts/sources/youtube.js.
Test it with age-restricted videos. Status: waiting for review

## pi-net → telegram-v2 (2026-05-10 16:45)
Tested with 10 videos. Age-restricted ones fail. Added fallback
to whisper transcription when captions unavailable. Status: done
```

No message broker. No polling. No API. Just markdown on a shared filesystem. Obsidian renders it. Agents read it. Humans see it too.

## Development Workflow

### Starting a new feature
```bash
cd ~/dev/Thoth
wt my-feature
thoth                      # pick the new worktree, start session
```

### The agent codes in its worktree
- Edits `scripts/`, `Templates/`, `launchd/`
- Tests by running scripts directly
- Writes notes to main vault (clippings, test output, documentation)
- Posts status updates to Event Log.md

### Committing and sharing
```bash
git add scripts/   # only code, never notes
git commit -m "Add feature X"
git push
```

Other agents pull to sync code:
```bash
git pull origin main  # or rebase their branch
```

### Cleanup
```bash
git worktree remove ~/.worktrees/Thoth-old-branch
git branch -d old-branch
```

## Context Variables

These are set by the Pi shell wrapper and available in every session:

| Variable | Example | Meaning |
|----------|---------|---------|
| `git_status` | `🔀telegram-v2 🐙` | Current branch, worktree indicator, GitHub connected |
| `vault_path` | `/Users/risingtidesdev/dev/Thoth` | Main vault location — read/write notes here |
| `current_project` | `Thoth Obsidian Integration` | Active project focus |

## Available Tools

- **Obsidian plugins**: Dataview, Kanban, Tasks, Terminal, Local REST API (port 27124)
- **CLI tools**: `gh` (GitHub), `yt-dlp` (YouTube captions), `whisper` (transcription)
- **API keys**: DeepSeek V4 Flash (in `scripts/telegram-config.json`)
- **Daemons** (launchd): telegram-bot, living-dashboard, scratchpad-watcher, canvas-watcher
