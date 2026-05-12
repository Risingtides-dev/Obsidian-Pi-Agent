# pi-vault Bootstrap

Give the prompt below to Codex or Claude on your friend's machine after they clone the repo.

This repo should be treated as the source of truth for code and portable config. The local machine should remain the source of truth for secrets, auth, sessions, and tokens.

## Agent Prompt

```text
You are bootstrapping `pi-vault` from a cloned repository on this machine.

Do not assume any fixed file paths, usernames, or home directories.

Start by reading:
- `README.md`
- `AGENTS.md`
- `docs/pi-vault.bootstrap.json`

Then run:
- `node scripts/bootstrap-pi-vault.js`

Use the script output plus the manifest to complete the local install.

## Your job

Set up this machine so:
- the repo's Obsidian vault can be opened locally
- the PI Cockpit hub runs at `http://localhost:3099`
- the local `pi-cockpit` Obsidian plugin can connect to the hub
- the expected MCP definitions exist locally
- the expected PI package settings exist locally
- no session history is imported

## Rules

- Discover local paths at runtime.
- Use the repo as the source of truth for code and portable settings.
- Keep secrets, auth, tokens, certs, and session history local to this machine.
- Do not import `~/.pi/agent/sessions` or any `*.jsonl` session files.
- Do not import another machine's `auth.json`, TLS certs, private keys, or API tokens.
- If a machine-specific executable does not exist locally, keep that tool disabled and report it.

## Setup tasks

1. Verify the repo looks like a valid `pi-vault` checkout.
2. Infer the vault path from the repo contents.
3. Generate the machine-local PI Cockpit launchd plist from `scripts/bootstrap-pi-vault.js`.
4. Install or update the local LaunchAgent in `~/Library/LaunchAgents/`.
5. Load or reload the LaunchAgent.
6. Verify `http://localhost:3099/health`.
7. Configure the Obsidian plugins listed in `docs/pi-vault.bootstrap.json`.
8. Merge MCP definitions into local `~/.claude.json` using the manifest as a template:
   - never copy secret values from another machine
   - leave required env vars empty or preserve local ones
   - rewrite the Obsidian MCP vault path to the local vault parent directory
9. Merge PI package settings into local `~/.pi/agent/settings.json`.
10. Verify that no sessions were imported.

## Final report

Return:
1. what you changed
2. what still needs local secrets or manual installs
3. exact files you touched
```

## Notes

- `docs/pi-vault.bootstrap.json` is the machine-readable manifest.
- `scripts/bootstrap-pi-vault.js` generates a path-agnostic local PI Cockpit plist.
- This repo does not, by design, contain machine-local secrets or session history.
