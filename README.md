# Vaultkeeper — Obsidian Pi Agent Template

Autonomous agent infrastructure living inside an Obsidian vault. **{{AGENT_NAME}}** — your digital twin — manages context, orchestrates tools, and bridges your ecosystem into a living dashboard.

## Template Variables

Before deploying, replace these placeholders throughout the project:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{AGENT_NAME}}` | Your agent's name | `Vaultkeeper`, `Athena`, `Jarvis` |
| `{{USER_NAME}}` | Your name | `Eric`, `Alex` |
| `{{USER_LOCATION}}` | Your location | `Los Angeles, CA` |
| `{{USER_BACKGROUND}}` | Brief background | `Developer with marketing roots` |
| `{{USER_ROLE}}` | What you do | `Founder of a creative agency` |
| `{{USER_PASSION}}` | What drives you | `Building agentic AI systems` |
| `{{VAULT_PATH}}` | Absolute path to this vault | `/Users/me/Documents/MyVault` |
| `{{HOST_NAME}}` | Machine hostname | `my-macbook`, `home-server` |
| `{{TAILSCALE_IP}}` | Tailscale IP (if used) | `100.x.x.x` |
| `{{TMA_DOMAIN}}` | Telegram Mini App domain | `tma.yourdomain.com` |
| `{{NODE_PATH}}` | Path to node binary | `/opt/homebrew/bin/node` |
| `{{LAUNCHD_PREFIX}}` | launchd label prefix | `com.vaultkeeper` |

## Quick Start

```bash
# 1. Clone into your Obsidian vault folder
git clone https://github.com/Risingtides-dev/Obsidian-Pi-Agent.git MyVault

# 2. Copy config examples
cp scripts/telegram-config.example.json scripts/telegram-config.json

# 3. Edit config with your API keys and paths
$EDITOR scripts/telegram-config.json

# 4. Install dependencies
npm install
cd pi-cockpit/hub && npm install

# 5. Generate launchd plists for your machine
node scripts/bootstrap-pi-vault.js

# 6. Load daemons
launchctl load ~/Library/LaunchAgents/{{LAUNCHD_PREFIX}}.*.plist
```

## PI Cockpit

Widget-based control surface for PI coding agents, embedded in Obsidian via a companion plugin (`pi-cockpit/obsidian-plugin/`). The hub serves as a WebSocket + REST API server on port 3099.

### Native Widgets (rendered by companion plugin)

| Widget | Purpose |
|--------|---------|
| Session Switcher | Switch between active PI coding sessions |
| Vault Chat | Chat with your Obsidian vault via PI |
| Skills Directory | Browse & copy skill references |
| Model Switcher | Switch AI models & thinking levels |
| Routines Manager | Manage recurring PI agent routines |

### Standalone Web Widgets

| Widget | URL | Purpose |
|--------|-----|---------|
| Cron Dashboard | `http://localhost:3099/widget/cron-dashboard` | Monitor scheduled jobs and daemon health |

**Architecture:** WebSocket hub (`pi-cockpit/hub/server.js`) + companion Obsidian plugin (`pi-cockpit/obsidian-plugin/`). Runs as a launchd daemon on port 3099.

## What's Inside

| Component | Description |
|-----------|-------------|
| `scripts/telegram-bot.js` | 24/7 Telegram bot — text, URLs, voice, images -> summarize -> vault |
| `scripts/sync-living-dashboard.js` | 5-min sync orchestrator for Living.md dashboard |
| `scripts/sources/` | Data sources (GitHub, filesystem, Notion, Calendar, Gmail) |
| `scripts/render.js` | HTML dashboard generator |
| `scripts/clip.js` | CLI web clipper with DeepSeek summarization |
| `scripts/watch-scratchpad.js` | Scratchpad.md watcher (Claude-powered) |
| `Templates/` | Web Clipper and note templates |

## Architecture

```
{{VAULT_PATH}}/                     <- Obsidian vault + agent root
├── scripts/                        <- All agent code
|   ├── telegram-bot.js             <- Telegram -> vault pipeline
|   ├── sync-living-dashboard.js    <- Dashboard orchestrator
|   ├── sources/                    <- Data source modules
|   └── clip.js                     <- CLI web clipper
├── Living.md                       <- Auto-generated dashboard
├── Scratchpad.md                   <- Real-time AI scratchpad
├── Templates/                      <- Note & clipper templates
└── logs/                           <- Daemon logs
```

## Daemons (launchd)

| Service | Interval | Config |
|---------|----------|--------|
| `{{LAUNCHD_PREFIX}}.telegram-bot` | always-on | `scripts/telegram-config.json` |
| `{{LAUNCHD_PREFIX}}.living-dashboard` | 5 min | `scripts/living-config.json` |
| `{{LAUNCHD_PREFIX}}.scratchpad-watcher` | on-change | Scratchpad.md |
| `{{LAUNCHD_PREFIX}}.pi-cockpit` | always-on | `pi-cockpit/hub/server.js` |

## pi-vault Bootstrap

This repo can act as a handoff source for a fresh local setup.

- Human-readable agent handoff prompt: `.github/PI_VAULT_BOOTSTRAP.md`
- Machine-readable bootstrap manifest: `docs/pi-vault.bootstrap.json`
- Path-agnostic local launchd generator: `scripts/bootstrap-pi-vault.js`

**The intended flow:**
1. Clone the repo
2. Point an agent at the repo
3. Have the agent read the bootstrap prompt + manifest
4. Generate machine-local paths and launchd config
5. Configure local plugins, MCP definitions, and PI settings without importing sessions or secrets from another machine

## Connected Services (Template)

Configure these in your environment:

| Service | How to Connect |
|---------|---------------|
| Telegram | Bot token from @BotFather -> `scripts/telegram-config.json` |
| GitHub | `gh auth login` |
| Obsidian | Local REST API plugin (port 27124) + MCP server |
| Notion | MCP server with `NOTION_TOKEN` env var |
| Tailscale | `tailscale up` on host machine |
| Cloudflare | `cloudflared` tunnel for TMA domain |
| DeepSeek | API key in config for summarization |

## Requirements

- Node.js 22+
- yt-dlp (for YouTube captions)
- openai-whisper (for voice transcription)
- DeepSeek API key (or swap for any LLM provider)
- Telegram Bot Token (from @BotFather)
