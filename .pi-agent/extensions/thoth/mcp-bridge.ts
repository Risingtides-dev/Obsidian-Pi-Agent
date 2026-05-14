/**
 * Thoth — MCP Bridge
 *
 * Bridges existing Claude Code MCP servers into pi.
 * Reads ~/.claude.json, starts MCP processes via stdio,
 * discovers their tools via tools/list, and registers them
 * as pi tools with automatic JSON-RPC forwarding.
 *
 * Tool names are prefixed: {server}_{tool} (e.g., notion_search)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ────────────────────────────────────────────────────

interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string> | string[];
  type?: string;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResult {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type McpMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResult;

// ── Load MCP Config ──────────────────────────────────────────

function loadMcpServers(): Record<string, McpServerConfig> {
  const claudeJson = path.join(os.homedir(), ".claude.json");
  try {
    const raw = fs.readFileSync(claudeJson, "utf-8");
    const data = JSON.parse(raw);
    return data.mcpServers ?? {};
  } catch {
    return {};
  }
}

// ── MCP Client (one per server) ──────────────────────────────

class McpClient {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private tools: McpToolDef[] = [];
  private dead = false;

  constructor(
    public readonly serverName: string,
    private config: McpServerConfig,
  ) {}

  async start(): Promise<void> {
    if (this.dead) return;
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doStart();
    return this.initPromise;
  }

  private async _doStart(): Promise<void> {
    const env = { ...process.env };
    if (Array.isArray(this.config.env)) {
      for (const key of this.config.env) {
        if (process.env[key]) env[key] = process.env[key];
      }
    } else if (this.config.env) {
      Object.assign(env, this.config.env);
    }

    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.config.command, this.config.args, {
          env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
      } catch (err: any) {
        this.dead = true;
        reject(new Error(`Failed to spawn ${this.serverName}: ${err.message}`));
        return;
      }

      let stderr = "";

      this.proc.stdout!.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as McpMessage;
            this.handleMessage(msg);
          } catch {
            // Ignore non-JSON stdout
          }
        }
      });

      this.proc.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      this.proc.on("error", (err) => {
        this.dead = true;
        reject(new Error(`${this.serverName} process error: ${err.message}`));
      });

      this.proc.on("close", (code) => {
        this.dead = true;
        if (!this.initialized) {
          reject(new Error(`${this.serverName} exited with code ${code}. stderr: ${stderr.slice(0, 200)}`));
        }
      });

      // Start the MCP handshake
      this.initialize()
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  private async initialize(): Promise<void> {
    // Send initialize request
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "thoth-pi", version: "1.0.0" },
    });

    // Send initialized notification (not expecting response)
    this.sendNotification("notifications/initialized", {});

    // Discover tools
    const toolsResult = (await this.sendRequest("tools/list", {})) as { tools: McpToolDef[] };
    this.tools = toolsResult.tools ?? [];

    this.initialized = true;
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });

      const payload = JSON.stringify(request) + "\n";
      this.proc?.stdin?.write(payload);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request ${method} timed out after 30s`));
        }
      }, 30_000);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.proc?.stdin?.write(JSON.stringify(notification) + "\n");
  }

  private handleMessage(msg: McpMessage): void {
    if ("id" in msg && "result" in msg) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
    // Notifications and requests from server are ignored for now
  }

  getTools(): McpToolDef[] {
    return this.tools;
  }

  getServerName(): string {
    return this.serverName;
  }

  isReady(): boolean {
    return this.initialized && !this.dead;
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) throw new Error(`${this.serverName} not initialized`);
    if (this.dead) throw new Error(`${this.serverName} is dead`);
    return this.sendRequest("tools/call", { name: toolName, arguments: args });
  }

  kill(): void {
    this.dead = true;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL");
      }, 3000);
    }
  }
}

// ── MCP Bridge Manager ───────────────────────────────────────

class McpBridge {
  private clients = new Map<string, McpClient>();
  private toolToServer = new Map<string, string>(); // piToolName → serverName
  private loaded = false;
  private loadError: string | null = null;

  constructor(private pi: ExtensionAPI) {}

  async start(): Promise<{ started: number; failed: string[] }> {
    if (this.loaded) return { started: this.clients.size, failed: [] };

    const configs = loadMcpServers();
    const failed: string[] = [];

    for (const [serverName, config] of Object.entries(configs)) {
      const client = new McpClient(serverName, config);
      this.clients.set(serverName, client);

      try {
        await client.start();
        const tools = client.getTools();
        for (const tool of tools) {
          // Prefix tool name with server to avoid conflicts
          const piToolName = `${serverName}_${tool.name}`;
          this.toolToServer.set(piToolName, serverName);
          this.registerTool(piToolName, tool, client);
        }
      } catch (err: any) {
        failed.push(`${serverName}: ${err.message}`);
      }
    }

    this.loaded = true;
    return { started: this.clients.size - failed.length, failed };
  }

  private registerTool(piToolName: string, def: McpToolDef, client: McpClient): void {
    // Build Typebox schema from JSON Schema
    let parameters = Type.Object({});
    try {
      if (def.inputSchema?.properties) {
        const props: Record<string, any> = {};
        for (const [key, schema] of Object.entries(def.inputSchema.properties)) {
          const jsonSchema = schema as any;
          switch (jsonSchema.type) {
            case "string":
              props[key] = Type.Optional(Type.String({ description: jsonSchema.description ?? key }));
              break;
            case "number":
            case "integer":
              props[key] = Type.Optional(Type.Number({ description: jsonSchema.description ?? key }));
              break;
            case "boolean":
              props[key] = Type.Optional(Type.Boolean({ description: jsonSchema.description ?? key }));
              break;
            case "array":
              // Arrays — just accept any array shape
              props[key] = Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: jsonSchema.description ?? key }));
              break;
            case "object":
              props[key] = Type.Optional(Type.Object({}, { description: jsonSchema.description ?? key, additionalProperties: true }));
              break;
            default:
              // For unknown types, don't constrain the parameter
              break;
          }
        }
        // Check required fields
        if (def.inputSchema.required) {
          for (const req of def.inputSchema.required) {
            const existing = props[req];
            if (existing && existing[TYPEBOX_OPTIONAL] !== undefined) {
              // Make it required
              if (existing.type === "string") {
                props[req] = Type.String({ description: def.inputSchema.properties?.[req]?.description ?? req });
              } else if (existing.type === "number") {
                props[req] = Type.Number({ description: def.inputSchema.properties?.[req]?.description ?? req });
              } else if (existing.type === "boolean") {
                props[req] = Type.Boolean({ description: def.inputSchema.properties?.[req]?.description ?? req });
              }
            }
          }
        }
        if (Object.keys(props).length > 0) {
          parameters = Type.Object(props);
        }
      }
    } catch {
      // Fall back to empty object schema
    }

    const serverName = client.getServerName();
    const toolName = def.name;

    this.pi.registerTool({
      name: piToolName,
      label: `${serverName}:${toolName}`,
      description: def.description ?? `MCP tool from ${serverName}: ${toolName}`,
      promptSnippet: `${def.description ?? toolName} (via ${serverName})`,
      promptGuidelines: [
        `Use ${piToolName} to interact with ${serverName}. This tool comes from the ${serverName} MCP server.`,
      ],
      parameters,
      async execute(_toolCallId, params, signal) {
        if (!client.isReady()) {
          return {
            content: [{ type: "text", text: `⚠️ ${serverName} MCP server is not connected.` }],
            details: { error: true, server: serverName, status: "offline" },
          };
        }

        try {
          const result = (await client.callTool(toolName, params as Record<string, unknown>)) as {
            content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
          };

          // Extract text content
          if (result?.content) {
            const text = result.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");
            return {
              content: [{ type: "text", text: text || JSON.stringify(result, null, 2) }],
              details: { server: serverName, tool: toolName, result },
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: { server: serverName, tool: toolName, result },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `❌ ${serverName} error: ${err.message}` }],
            details: { error: true, server: serverName, message: err.message },
          };
        }
      },
    });
  }

  getStatus(): { server: string; ready: boolean; toolCount: number }[] {
    const status: { server: string; ready: boolean; toolCount: number }[] = [];
    for (const [name, client] of this.clients) {
      status.push({
        server: name,
        ready: client.isReady(),
        toolCount: client.getTools().length,
      });
    }
    return status;
  }

  shutdown(): void {
    for (const client of this.clients.values()) {
      client.kill();
    }
    this.clients.clear();
    this.toolToServer.clear();
    this.loaded = false;
  }
}

// Typebox internal marker for optional
const TYPEBOX_OPTIONAL = Symbol.for("TypeBox.Optional");

// ── Extension API ────────────────────────────────────────────

export function registerMcpBridge(pi: ExtensionAPI): void {
  let bridge: McpBridge | null = null;

  // Start MCP servers after session starts (async factory-like)
  pi.on("session_start", async (_event, ctx) => {
    if (bridge) bridge.shutdown();

    bridge = new McpBridge(pi);
    ctx.ui.setStatus("thoth-mcp", "🔌 Connecting MCP servers...");

    try {
      const { started, failed } = await bridge.start();
      const toolCount = Array.from(bridge.getStatus()).reduce((sum, s) => sum + s.toolCount, 0);

      if (started > 0) {
        ctx.ui.setStatus(
          "thoth-mcp",
          `🔌 ${started} MCP server(s), ${toolCount} tools` +
            (failed.length > 0 ? ` (${failed.length} failed)` : ""),
        );
      } else {
        ctx.ui.setStatus("thoth-mcp", "⚠️ No MCP servers connected");
      }

      if (failed.length > 0) {
        ctx.ui.notify(`MCP failures: ${failed.join(", ")}`, "warning");
      }
    } catch (err: any) {
      ctx.ui.setStatus("thoth-mcp", `❌ MCP bridge failed: ${err.message}`);
    }
  });

  // Shutdown on session end
  pi.on("session_shutdown", async () => {
    bridge?.shutdown();
    bridge = null;
  });

  // Status command
  pi.registerCommand("mcp-status", {
    description: "Show MCP bridge status",
    handler: async (_args, ctx) => {
      if (!bridge) {
        ctx.ui.notify("MCP bridge not initialized. Start a new session.", "warning");
        return;
      }
      const status = bridge.getStatus();
      if (status.length === 0) {
        ctx.ui.notify("No MCP servers configured.", "info");
        return;
      }
      const lines = ["🔌 **MCP Bridge Status**", ""];
      for (const s of status) {
        const icon = s.ready ? "✅" : "❌";
        lines.push(`${icon} **${s.server}** — ${s.toolCount} tool(s)`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
