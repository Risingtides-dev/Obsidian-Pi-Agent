/**
 * {{AGENT_NAME}} — Persistent Memory System
 *
 * Three-tier memory:
 *   1. Ephemeral (in-Map, session-scoped)
 *   2. File-based (~/.pi/agent/extensions/agent-core/memory/*.json)
 *   3. Session-persisted (pi.appendEntry for tree-aware state)
 *
 * Tools:
 *   - remember <key> <value> — store a fact
 *   - recall <key> — retrieve a fact
 *   - forget <key> — delete a fact
 *   - search_memory <query> — full-text search across memories
 *   - set_context <key> <value> — set a context variable (shown in system prompt)
 *   - get_context <key> — get a context variable
 *   - list_memories — list all memory keys with search
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeJsonSafe, readJsonSafe, listJsonDir } from "./utils.js";

const MEMORY_DIR = "~/.pi/agent/extensions/agent-core/memory";
const CONTEXT_DIR = "~/.pi/agent/extensions/agent-core/context";

export interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface {{AGENT_NAME}}Memory {
  /** Get a memory value */
  get(key: string): string | undefined;
  /** Set a memory value */
  set(key: string, value: string, tags?: string[]): void;
  /** Delete a memory */
  delete(key: string): void;
  /** Full-text search across memory values */
  search(query: string): Array<{ key: string; value: string; score: number }>;
  /** List all memory keys */
  listAll(): string[];
  /** Load all memories from disk */
  loadAll(): Map<string, MemoryEntry>;
  /** Set context variable */
  setContext(key: string, value: string): void;
  /** Get context variable */
  getContext(key: string): string | undefined;
  /** Get all context as a map */
  getAllContext(): Record<string, string>;
}

export function createMemory(): {{AGENT_NAME}}Memory {
  const cache = new Map<string, MemoryEntry>();
  const context = new Map<string, string>();

  // Ensure directories exist
  const memDir = path.resolve(require("node:os").homedir(), ".pi/agent/extensions/agent-core/memory");
  const ctxDir = path.resolve(require("node:os").homedir(), ".pi/agent/extensions/agent-core/context");
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  if (!fs.existsSync(ctxDir)) fs.mkdirSync(ctxDir, { recursive: true });

  // Load existing memories
  const keys = listJsonDir(MEMORY_DIR);
  for (const key of keys) {
    const entry = readJsonSafe<MemoryEntry | null>(path.join(memDir, `${key}.json`), null);
    if (entry) cache.set(key, entry);
  }

  // Load existing context
  const ctxKeys = listJsonDir(CONTEXT_DIR);
  for (const key of ctxKeys) {
    const val = readJsonSafe<string | null>(path.join(ctxDir, `${key}.json`), null);
    if (val !== null) context.set(key, val);
  }

  return {
    get(key: string): string | undefined {
      return cache.get(key)?.value;
    },

    set(key: string, value: string, tags?: string[]): void {
      const now = Date.now();
      const existing = cache.get(key);
      const entry: MemoryEntry = {
        key,
        value,
        tags: tags ?? existing?.tags ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      cache.set(key, entry);
      writeJsonSafe(path.join(memDir, `${key}.json`), entry);
    },

    delete(key: string): void {
      cache.delete(key);
      const resolved = path.resolve(require("node:os").homedir(), `.pi/agent/extensions/agent-core/memory/${key}.json`);
      try {
        fs.unlinkSync(resolved);
      } catch {
        // ignore if file doesn't exist
      }
    },

    search(query: string): Array<{ key: string; value: string; score: number }> {
      const q = query.toLowerCase();
      const results: Array<{ key: string; value: string; score: number }> = [];
      for (const [key, entry] of cache) {
        let score = 0;
        if (key.toLowerCase().includes(q)) score += 10;
        if (entry.value.toLowerCase().includes(q)) score += 5;
        for (const tag of entry.tags) {
          if (tag.toLowerCase().includes(q)) score += 3;
        }
        if (score > 0) results.push({ key, value: entry.value, score });
      }
      return results.sort((a, b) => b.score - a.score);
    },

    listAll(): string[] {
      return Array.from(cache.keys()).sort();
    },

    loadAll(): Map<string, MemoryEntry> {
      return new Map(cache);
    },

    setContext(key: string, value: string): void {
      context.set(key, value);
      const ctxDir = path.resolve(require("node:os").homedir(), ".pi/agent/extensions/agent-core/context");
      writeJsonSafe(path.join(ctxDir, `${key}.json`), value);
    },

    getContext(key: string): string | undefined {
      return context.get(key);
    },

    getAllContext(): Record<string, string> {
      const result: Record<string, string> = {};
      for (const [key, val] of context) result[key] = val;
      return result;
    },
  };
}

export function registerMemoryTools(pi: ExtensionAPI, memory: {{AGENT_NAME}}Memory): void {
  // remember — store a fact
  pi.registerTool({
    name: "remember",
    label: "Remember",
    description: "Store a fact or piece of information in persistent memory. Use this to remember user preferences, project details, decisions, and anything else worth keeping across sessions.",
    promptSnippet: "Store information in {{AGENT_NAME}}'s persistent memory",
    promptGuidelines: [
      "Use remember/set_context to persist important information across sessions.",
      "Use recall/search_memory to retrieve previously stored information.",
      "Context variables (set_context/get_context) are shown in the system prompt summary.",
    ],
    parameters: Type.Object({
      key: Type.String({ description: "The memory key (use a descriptive dot-separated path like 'user.preferences.theme' or 'project.{{AGENT_NAME_LOWER}}.architecture')" }),
      value: Type.String({ description: "The value to remember" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for searching" })),
    }),
    async execute(_toolCallId, params) {
      memory.set(params.key, params.value, params.tags);
      return {
        content: [{ type: "text", text: `✅ Remembered \`${params.key}\`` }],
        details: { action: "remembered", key: params.key, tags: params.tags },
      };
    },
  });

  // recall — retrieve a fact
  pi.registerTool({
    name: "recall",
    label: "Recall",
    description: "Retrieve a previously stored fact from persistent memory by its exact key.",
    promptSnippet: "Retrieve information from {{AGENT_NAME}}'s persistent memory",
    parameters: Type.Object({
      key: Type.String({ description: "The memory key to retrieve" }),
    }),
    async execute(_toolCallId, params) {
      const value = memory.get(params.key);
      if (value === undefined) {
        return {
          content: [{ type: "text", text: `⚠️ Nothing found for key \`${params.key}\`` }],
          details: { action: "not_found", key: params.key },
        };
      }
      return {
        content: [{ type: "text", text: value }],
        details: { action: "recalled", key: params.key, value },
      };
    },
  });

  // forget — delete a fact
  pi.registerTool({
    name: "forget",
    label: "Forget",
    description: "Delete a previously stored fact from persistent memory by its key.",
    parameters: Type.Object({
      key: Type.String({ description: "The memory key to forget/delete" }),
    }),
    async execute(_toolCallId, params) {
      memory.delete(params.key);
      return {
        content: [{ type: "text", text: `🗑️ Forgotten \`${params.key}\`` }],
        details: { action: "forgotten", key: params.key },
      };
    },
  });

  // search_memory — full-text search
  pi.registerTool({
    name: "search_memory",
    label: "Search Memory",
    description: "Full-text search across all stored memories. Returns matching keys ranked by relevance.",
    promptSnippet: "Search {{AGENT_NAME}}'s persistent memory by keyword",
    parameters: Type.Object({
      query: Type.String({ description: "Search query to match against keys, values, and tags" }),
    }),
    async execute(_toolCallId, params) {
      const results = memory.search(params.query);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `🔍 No memories found matching "${params.query}"` }],
          details: { action: "searched", query: params.query, count: 0 },
        };
      }
      const lines = results.map(
        (r, i) => `${i + 1}. **${r.key}** (score: ${r.score})\n   ${r.value.slice(0, 200)}${r.value.length > 200 ? "..." : ""}`,
      );
      return {
        content: [{ type: "text", text: `🔍 Found ${results.length} memories:\n\n${lines.join("\n\n")}` }],
        details: { action: "searched", query: params.query, count: results.length, results },
      };
    },
  });

  // set_context — set a context variable
  pi.registerTool({
    name: "set_context",
    label: "Set Context",
    description: "Set a context variable that will be shown in the session summary. Use for 'current project', 'active task', 'mode' (work/personal/learning), etc.",
    promptSnippet: "Set a context variable for the current session state",
    parameters: Type.Object({
      key: Type.String({ description: "Context variable name (e.g., '{{AGENT_NAME_LOWER}}.current_project', 'git_status', 'active_task')" }),
      value: Type.String({ description: "Context variable value" }),
    }),
    async execute(_toolCallId, params) {
      memory.setContext(params.key, params.value);
      return {
        content: [{ type: "text", text: `📌 Context \`${params.key}\` = \`${params.value}\`` }],
        details: { action: "context_set", key: params.key, value: params.value },
      };
    },
  });

  // get_context — get a context variable
  pi.registerTool({
    name: "get_context",
    label: "Get Context",
    description: "Get the value of a context variable.",
    parameters: Type.Object({
      key: Type.String({ description: "Context variable name" }),
    }),
    async execute(_toolCallId, params) {
      const value = memory.getContext(params.key);
      if (value === undefined) {
        return {
          content: [{ type: "text", text: `⚠️ No context variable \`${params.key}\`` }],
          details: { action: "context_not_found", key: params.key },
        };
      }
      return {
        content: [{ type: "text", text: `\`${params.key}\` = ${value}` }],
        details: { action: "context_got", key: params.key, value },
      };
    },
  });

  // list_memories — list all stored keys
  pi.registerTool({
    name: "list_memories",
    label: "List Memories",
    description: "List all memory keys stored in persistent memory, optionally filtered by a search term.",
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Optional filter to narrow results" })),
    }),
    async execute(_toolCallId, params) {
      let keys = memory.listAll();
      if (params.filter) {
        const f = params.filter.toLowerCase();
        keys = keys.filter((k) => k.toLowerCase().includes(f));
      }
      if (keys.length === 0) {
        return {
          content: [{ type: "text", text: "📭 No memories stored yet." }],
          details: { action: "listed", count: 0 },
        };
      }
      const lines = keys.map((k) => {
        const val = memory.get(k);
        const preview = val ? val.slice(0, 60) : "";
        return `- **${k}**: ${preview}${val && val.length > 60 ? "..." : ""}`;
      });
      return {
        content: [{ type: "text", text: `📚 ${keys.length} memories:\n\n${lines.join("\n")}` }],
        details: { action: "listed", count: keys.length, keys },
      };
    },
  });
}

/** Build a context summary string from memory for the system prompt */
export function buildContextSummary(memory: {{AGENT_NAME}}Memory): string {
  const ctx = memory.getAllContext();
  const entries = Object.entries(ctx);
  if (entries.length === 0) return "";
  return (
    `\n## Current Context\n${entries.map(([k, v]) => `- **${k}**: ${v}`).join("\n")}`
  );
}
