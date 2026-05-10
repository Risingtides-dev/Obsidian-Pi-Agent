/**
 * Reads skills and MCP server configurations from the user's PI setup.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { state } from "./state.js";

const HOME = os.homedir();

/**
 * Scan PI skills directory for available skills.
 */
export function scanSkills() {
  const skillsDirs = [
    path.join(HOME, ".pi", "agent", "skills"),
    path.join(HOME, ".agents", "skills"),
  ];

  state.skills = [];

  for (const dir of skillsDirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

        const skillPath = path.join(dir, entry.name);
        const skillMd = path.join(skillPath, "SKILL.md");

        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, "utf-8");
          // Extract description from YAML frontmatter or first heading
          const descMatch = content.match(/description:\s*(.+)/i);
          const description = descMatch
            ? descMatch[1].trim()
            : "No description";

          state.skills.push({
            name: entry.name,
            path: skillPath,
            description,
            source: dir.includes(".agents") ? "global" : "pi",
          });
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  // Deduplicate by name
  const seen = new Set();
  state.skills = state.skills.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  state.skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan MCP server configurations from Claude and PI configs.
 */
export function scanMcpServers() {
  state.mcpServers = [];

  // Try Claude config
  try {
    const claudeConfig = JSON.parse(
      fs.readFileSync(path.join(HOME, ".claude.json"), "utf-8")
    );
    if (claudeConfig.mcpServers) {
      for (const [name, config] of Object.entries(claudeConfig.mcpServers)) {
        state.mcpServers.push({
          name,
          source: "claude",
          command: config.command,
          args: config.args,
        });
      }
    }
  } catch {}

  // Also check PI MCP configs
  try {
    const piMcpDir = path.join(HOME, ".pi", "agent", "mcp");
    if (fs.existsSync(piMcpDir)) {
      const files = fs.readdirSync(piMcpDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          state.mcpServers.push({
            name: file.replace(".json", ""),
            source: "pi",
          });
        }
      }
    }
  } catch {}

  state.mcpServers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generate clipboard-ready text for a skill reference.
 */
export function getSkillClipboardText(skillName) {
  const skill = state.skills.find(s => s.name === skillName);
  if (!skill) return null;
  return `Load the ${skill.name} skill from ${skill.path}/SKILL.md`;
}

/**
 * Generate clipboard-ready text for an MCP server reference.
 */
export function getMcpClipboardText(serverName) {
  const server = state.mcpServers.find(s => s.name === serverName);
  if (!server) return null;
  return `Use the ${server.name} MCP server${server.command ? ` (${server.command})` : ""}`;
}
