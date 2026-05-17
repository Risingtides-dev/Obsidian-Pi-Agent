# Launchd Daemon Templates

These `.plist` templates use `{{PLACEHOLDER}}` variables. The bootstrap script (`scripts/bootstrap-pi-vault.js`) generates machine-local versions with real paths.

## Variables

| Placeholder | Description |
|-------------|-------------|
| `{{LAUNCHD_PREFIX}}` | Label prefix (e.g., `com.vaultkeeper`) |
| `{{NODE_PATH}}` | Absolute path to node binary |
| `{{VAULT_PATH}}` | Absolute path to the vault root |
| `{{HOME_PATH}}` | User home directory |

## Daemons

| File | Purpose | Schedule |
|------|---------|----------|
| `LAUNCHD_PREFIX.telegram-bot.plist` | Telegram capture bot | always-on |
| `LAUNCHD_PREFIX.pi-cockpit.plist` | PI Cockpit WebSocket hub | always-on |
| `LAUNCHD_PREFIX.living-dashboard.plist` | Dashboard sync | every 5 min |
| `LAUNCHD_PREFIX.scratchpad-watcher.plist` | Scratchpad AI responder | on file change |
| `LAUNCHD_PREFIX.canvas-watcher.plist` | Canvas change watcher | on file change |
| `LAUNCHD_PREFIX.vaultkeeper-heartbeat.plist` | Health heartbeat | every 60s |

## Installation

```bash
# Generate from templates:
node scripts/bootstrap-pi-vault.js

# Or manually copy to LaunchAgents and replace variables:
cp launchd/*.plist ~/Library/LaunchAgents/
# Then sed or your editor to replace {{PLACEHOLDERS}}

# Load all:
launchctl load ~/Library/LaunchAgents/{{LAUNCHD_PREFIX}}.*.plist
```
