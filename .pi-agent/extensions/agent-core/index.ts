/**
 * {{AGENT_NAME}} — Agentic Harness for pi
 *
 * A lean, powerful agent harness that serves as your digital twin.
 * Composes battle-tested pi packages with {{AGENT_NAME}}'s unique capabilities.
 *
 * {{AGENT_NAME}}'s custom modules:
 *   - memory       Persistent key-value store with search
 *   - brave-search Web search via Brave Search API
 *
 * Installed packages (auto-load, no code needed):
 *   - pi-mcp-adapter   → MCP bridge (Notion, etc.)
 *   - pi-subagents     → Sub-agent orchestration
 *   - pi-messenger     → Inter-agent communication
 *
 * Vault access: Obsidian CLI at /Applications/Obsidian.app/Contents/MacOS/Obsidian
 *   Usage: obsidian <command> vault={{AGENT_NAME_LOWER}} [options]
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMemory, registerMemoryTools, buildContextSummary } from "./memory.js";
import { registerBraveSearch } from "./brave-search.js";
import { onSessionStart, showWorktreeBrowser, buildVaultContext, countVaultDocs } from "./worktree.js";

export default function (pi: ExtensionAPI) {
  // ── Memory System ────────────────────────────────────────────
  const memory = createMemory();
  registerMemoryTools(pi, memory);

  // ── Brave Search ─────────────────────────────────────────────
  registerBraveSearch(pi);

  // ── Vault Reference (via Obsidian CLI) ───────────────────────
  // The Obsidian CLI handles all vault operations. Key commands:
  //   bash: obsidian read file="Note Name" vault={{AGENT_NAME_LOWER}}
  //   bash: obsidian search query="text" vault={{AGENT_NAME_LOWER}}
  //   bash: obsidian create name="New Note" content="..." vault={{AGENT_NAME_LOWER}}
  //   bash: obsidian append file="Note" content="..." vault={{AGENT_NAME_LOWER}}
  //   bash: obsidian tasks vault={{AGENT_NAME_LOWER}}
  // The CLI is at /Applications/Obsidian.app/Contents/MacOS/Obsidian
  // Obsidian.app must be running for CLI commands to work

  // ── Context Injection ────────────────────────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    const parts: string[] = [];
    
    // Vault reference docs (core identity, architecture, worktrees)
    const vaultCtx = buildVaultContext();
    if (vaultCtx) parts.push(vaultCtx);
    
    // Persistent memory summary
    const memorySummary = buildContextSummary(memory);
    if (memorySummary) parts.push(`## {{AGENT_NAME}} Context (from persistent memory)${memorySummary}`);
    
    if (parts.length === 0) return;
    return {
      systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n"),
    };
  });

  // ── Session Lifecycle ────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // Set up worktree context & status (non-blocking)
    await onSessionStart(pi, ctx);

    // Auto-update current_project from worktree context
    const rawGitStatus = memory.getContext("git_status");
    const gitStatus = typeof rawGitStatus === "string" ? rawGitStatus : "";
    // Strip non-ASCII (emojis, surrogates) — Codex rejects unpaired UTF-16 surrogates.
    const cleanStatus = gitStatus.replace(/[^\x20-\x7E]/g, "").trim();
    const branchMatch = cleanStatus.match(/(\S+)/);
    if (branchMatch) {
      const branch = branchMatch[1];
      const label = `{{AGENT_NAME}}-${branch.replace(/^pi-/, "")} / ${branch}`;
      memory.setContext("{{AGENT_NAME_LOWER}}.current_project", label);
    }

    const ctxVars = memory.getAllContext();
    const keyCount = memory.listAll().length;
    const vaultCount = countVaultDocs();

    const lines: string[] = [];
    if (keyCount > 0) lines.push(`📚 ${keyCount} memories`);
    if (vaultCount > 0) lines.push(`📄 ${vaultCount} vault docs`);
    if (ctxVars["{{AGENT_NAME_LOWER}}.current_project"]) lines.push(`📍 ${ctxVars["{{AGENT_NAME_LOWER}}.current_project"]}`);

    if (lines.length > 0) ctx.ui.setStatus("{{AGENT_NAME_LOWER}}", lines.join(" · "));
  });

  // ── Commands ─────────────────────────────────────────────────
  pi.registerCommand("{{AGENT_NAME_LOWER}}-status", {
    description: "Show {{AGENT_NAME}} status",
    handler: async (_args, ctx) => {
      const keyCount = memory.listAll().length;
      const ctxVars = memory.getAllContext();

      const lines = [
        "🧠 **{{AGENT_NAME}} Status**",
        "",
        `**Memories:** ${keyCount} stored`,
        `**Context:** ${Object.keys(ctxVars).length} variables`,
        "",
        "**Installed Packages:**",
        "  `pi-mcp-adapter` — MCP bridge (Notion, Obsidian, etc.)",
        "  `pi-subagents` — Sub-agent orchestration",
        "  `pi-messenger` — Inter-agent communication",
        "",
        "**Available Skills:** obsidian, excalidraw, gitbutler, total-recall, remotion-best-practices, paywall-upgrade-cro",
        "",
        "**{{AGENT_NAME}} Tools:** remember, recall, forget, search_memory, list_memories, set_context, get_context, {{AGENT_NAME_LOWER}}_search, {{AGENT_NAME_LOWER}}_vault_read, {{AGENT_NAME_LOWER}}_vault_search",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("wt", {
    description: "Browse & switch sessions across worktrees",
    handler: async (_args, ctx) => {
      await showWorktreeBrowser(pi, ctx);
    },
  });

  pi.registerCommand("{{AGENT_NAME_LOWER}}-search", {
    description: "Search the web via Brave Search",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /{{AGENT_NAME_LOWER}}-search <query>", "warning");
        return;
      }
      pi.sendUserMessage(`Search the web for: ${args}`);
    },
  });
}
