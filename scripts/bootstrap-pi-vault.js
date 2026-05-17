#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_DIR = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(REPO_DIR, "docs", "pi-vault.bootstrap.json");

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binName) {
  const pathValue = process.env.PATH || "";
  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) continue;
    const candidate = path.join(segment, binName);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function findVaultDir(repoDir, requiredMarkers) {
  const repoMatches = requiredMarkers.every((marker) => exists(path.join(repoDir, marker)));
  if (repoMatches) return repoDir;

  const entries = fs.readdirSync(repoDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(repoDir, entry.name);
    const matches = requiredMarkers.every((marker) => exists(path.join(candidate, marker)));
    if (matches) return candidate;
  }

  throw new Error("Could not infer vault directory from repo contents.");
}

function renderLaunchAgent({ label, nodeBin, vaultDir, homeDir, port }) {
  const hubDir = path.join(vaultDir, "pi-cockpit", "hub");
  const logsDir = path.join(vaultDir, "pi-cockpit", "logs");
  const pathValue = [
    path.dirname(nodeBin),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${hubDir}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathValue}</string>
    <key>HOME</key>
    <string>${homeDir}</string>
    <key>PORT</key>
    <string>${String(port)}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${path.join(logsDir, "hub-out.log")}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, "hub-err.log")}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const homeDir = os.homedir();
  const nodeBin = process.execPath;
  const npmBin = findOnPath("npm");
  const vaultDir = findVaultDir(REPO_DIR, manifest.vault.requiredMarkers);
  const vaultParentDir = path.dirname(vaultDir);
  const launchAgentPath = path.join(vaultDir, "launchd", "{{LAUNCHD_PREFIX}}.pi-cockpit.local.plist");
  const installedLaunchAgentPath = path.join(homeDir, "Library", "LaunchAgents", "{{LAUNCHD_PREFIX}}.pi-cockpit.local.plist");

  fs.mkdirSync(path.join(vaultDir, "pi-cockpit", "logs"), { recursive: true });
  fs.mkdirSync(path.dirname(launchAgentPath), { recursive: true });

  const plist = renderLaunchAgent({
    label: manifest.piCockpit.launchAgentLabel,
    nodeBin,
    vaultDir,
    homeDir,
    port: manifest.piCockpit.port
  });
  fs.writeFileSync(launchAgentPath, plist);

  const summary = {
    name: manifest.name,
    repoDir: REPO_DIR,
    vaultDir,
    vaultParentDir,
    homeDir,
    nodeBin,
    npmBin,
    launchAgentPath,
    installedLaunchAgentPath,
    healthEndpoint: manifest.piCockpit.healthEndpoint,
    pluginIds: manifest.obsidian.communityPlugins,
    mcpServerNames: Object.keys(manifest.mcp.definitions),
    piPackages: manifest.piSettings.packages,
    notes: [
      "This script only generates a machine-local launchd plist in the repo.",
      "It does not install LaunchAgents, merge MCP settings, copy secrets, or import sessions.",
      "Use the repo bootstrap prompt for full agent-driven setup."
    ]
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main();
