# Obsidian Pi Agent

Autonomous agent infrastructure living inside an Obsidian vault. Thoth — your digital twin — manages context, orchestrates tools, and bridges your ecosystem into a living dashboard.

## PI Cockpit (NEW)

Widget-based control surface for PI coding agents, designed to be embedded in Obsidian via Custom Frames.

| Widget | URL | Purpose |
|--------|-----|---------|
| Session Switcher | `http://localhost:3099/widget/session-switcher` | Switch between active PI coding sessions |
| Vault Chat | `http://localhost:3099/widget/vault-chat` | Chat with your Obsidian vault via PI |
| Skills Directory | `http://localhost:3099/widget/skills-directory` | Browse & copy skill references |
| Model Switcher | `http://localhost:3099/widget/model-switcher` | Switch AI models & thinking levels |

**Architecture:** WebSocket hub (`pi-cockpit/hub/server.js`) + widget web apps + companion Obsidian plugin (`pi-cockpit/obsidian-plugin/`). Runs as a launchd daemon on port 3099.

## What's inside

| Component | Description |
|-----------|-------------|
| `scripts/telegram-bot.js` | 24/7 Telegram bot — text, URLs, voice, images → summarize → vault |
| `scripts/sync-living-dashboard.js` | 5-min sync orchestrator for Living.md dashboard |
| `scripts/sources/` | Data sources (GitHub, filesystem, Notion, Calendar, Gmail) |
| `scripts/render.js` | HTML dashboard generator |
| `scripts/clip.js` | CLI web clipper with DeepSeek summarization |
| `scripts/watch-scratchpad.js` | Scratchpad.md watcher (Claude-powered) |
| `Templates/` | Web Clipper and note templates |

## Architecture

```
~/dev/Thoth/                    ← Obsidian vault + agent root
├── scripts/                    ← All agent code
│   ├── telegram-bot.js         ← Telegram → vault pipeline
│   ├── sync-living-dashboard.js ← Dashboard orchestrator
│   ├── sources/                ← Data source modules
│   └── clip.js                 ← CLI web clipper
├── Living.md                   ← Auto-generated dashboard
├── Scratchpad.md               ← Real-time AI scratchpad
├── Templates/                  ← Note & clipper templates
└── logs/                       ← Daemon logs
```

## Daemons (launchd)

| Service | Interval | Config |
|---------|----------|--------|
| `com.thoth.telegram-bot` | always-on | `scripts/telegram-config.json` |
| `com.thoth.living-dashboard` | 5 min | `scripts/living-config.json` |
| `com.thoth.scratchpad-watcher` | on-change | Scratchpad.md |

## Setup

1. Clone into your Obsidian vault folder
2. Copy config examples: `cp scripts/*-config.example.json scripts/*-config.json`
3. Add your API keys to the config files
4. `npm install`
5. Load launchd jobs: `launchctl load ~/Library/LaunchAgents/com.thoth.*.plist`

## Requires

- Node.js 22+
- yt-dlp (for YouTube captions)
- openai-whisper (for voice transcription)
- DeepSeek API key
- Telegram Bot Token (from @BotFather)
