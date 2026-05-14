/**
 * PI Bridge — SDK integration layer
 *
 * Wraps @mariozechner/pi-coding-agent for the PI Cockpit hub.
 * Manages one active AgentSession at a time. Forwards all agent
 * events as callbacks that the hub broadcasts to widgets.
 *
 * Uses AgentSessionRuntime for session lifecycle (new, switch, fork).
 */

import { createAgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { AuthStorage, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";
import { createAgentSessionServices, createAgentSessionFromServices } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { homedir } from "node:os";
import path from "node:path";

const AGENT_DIR = path.join(homedir(), ".pi", "agent");

export class PiBridge {
  constructor() {
    this.runtime = null;       // AgentSessionRuntime
    this.session = null;       // current AgentSession
    this.unsubscribe = null;   // event listener unsub
    this.onEvent = null;       // callback: (event) => void
    this.currentSessionName = null;

    // Shared services (created once, reused across session switches)
    this.authStorage = AuthStorage.create();
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    // Create the runtime factory
    this._runtimeFactory = this._createRuntimeFactory();
  }

  /**
   * Set the event callback. All agent events (text_delta, tool_execution_start,
   * agent_end, etc.) are forwarded here for the hub to broadcast.
   */
  setEventCallback(cb) {
    this.onEvent = cb;
  }

  // ──────────────────── Runtime factory ────────────────────

  _createRuntimeFactory() {
    const bridge = this;
    return async function createRuntime({ cwd, sessionManager, sessionStartEvent }) {
      const services = await createAgentSessionServices({ cwd });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        authStorage: bridge.authStorage,
        modelRegistry: bridge.modelRegistry,
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };
  }

  // ──────────────────── Session management ────────────────────

  /**
   * Start a new session or resume from a specific JSONL file.
   * @param {string} [sessionPath] - Path to a .jsonl session file, or omit for a new session
   * @param {string} [cwd] - Working directory (default: homedir)
   */
  async startSession(sessionPath, cwd) {
    // Tear down existing
    await this._teardown();

    const workDir = cwd || homedir();
    let sessionManager;

    if (sessionPath) {
      // Resume/switch to an existing session
      sessionManager = SessionManager.open(sessionPath);
    } else {
      // Start a new session (uses PI's default session creation)
      sessionManager = SessionManager.create(workDir);
    }

    this.runtime = await createAgentSessionRuntime(this._runtimeFactory, {
      cwd: workDir,
      agentDir: AGENT_DIR,
      sessionManager,
    });

    this.session = this.runtime.session;
    this._subscribe();
    console.log(`[pi-bridge] Session started: ${this.session.sessionId}`);
    return { sessionId: this.session.sessionId };
  }

  /**
   * Switch to a different session by JSONL file path.
   * Uses AgentSessionRuntime.switchSession which handles teardown + recreate.
   */
  async switchSession(sessionPath, cwd) {
    if (!this.runtime) {
      return this.startSession(sessionPath, cwd);
    }

    const workDir = cwd || this.runtime.cwd;
    const result = await this.runtime.switchSession(sessionPath, { cwdOverride: workDir });
    if (result.cancelled) {
      console.log("[pi-bridge] Session switch cancelled by extension");
      return { cancelled: true };
    }

    // Re-subscribe (session object changed)
    this.session = this.runtime.session;
    this._subscribe();
    console.log(`[pi-bridge] Switched to session: ${this.session.sessionId}`);
    return { sessionId: this.session.sessionId, cancelled: false };
  }

  /**
   * Start a fresh session.
   */
  async newSession(cwd) {
    await this._teardown();

    const workDir = cwd || homedir();
    this.runtime = await createAgentSessionRuntime(this._runtimeFactory, {
      cwd: workDir,
      agentDir: AGENT_DIR,
      sessionManager: SessionManager.create(workDir),
    });

    this.session = this.runtime.session;
    this._subscribe();
    console.log(`[pi-bridge] New session: ${this.session.sessionId}`);
    return { sessionId: this.session.sessionId };
  }

  async _teardown() {
    if (this.unsubscribe) {
      try { this.unsubscribe(); } catch {}
      this.unsubscribe = null;
    }
    if (this.session) {
      try { this.session.dispose(); } catch {}
      this.session = null;
    }
    this.runtime = null;
  }

  // ──────────────────── Event subscription ────────────────────

  _subscribe() {
    if (!this.session) return;
    const s = this.session;
    this.unsubscribe = s.subscribe((event) => {
      if (this.onEvent) {
        try { this.onEvent(event); } catch (e) { console.error("[pi-bridge] event callback error:", e); }
      }
    });
  }

  // ──────────────────── Chat ────────────────────

  /**
   * Send a chat message to the agent.
   */
  async sendMessage(text) {
    if (!this.session) throw new Error("No active session");
    await this.session.prompt(text);
  }

  /**
   * Queue a steering message (interrupt current turn).
   */
  async steer(text) {
    if (!this.session) throw new Error("No active session");
    await this.session.steer(text);
  }

  /**
   * Queue a follow-up message (deliver after agent finishes).
   */
  async followUp(text) {
    if (!this.session) throw new Error("No active session");
    await this.session.followUp(text);
  }

  /**
   * Abort current agent operation.
   */
  async abort() {
    if (!this.session) return;
    await this.session.abort();
  }

  // ──────────────────── Model & thinking ────────────────────

  /**
   * Set the model by provider + model ID.
   * @param {string} provider - e.g. "deepseek", "anthropic", "openai"
   * @param {string} modelId - e.g. "deepseek-v4-pro", "claude-sonnet-4"
   */
  async setModel(provider, modelId) {
    if (!this.session) throw new Error("No active session");
    const model = getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.session.setModel(model);
    console.log(`[pi-bridge] Model set: ${provider}/${modelId}`);
  }

  /**
   * Set the thinking level.
   * @param {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"} level
   */
  setThinking(level) {
    if (!this.session) throw new Error("No active session");
    this.session.setThinkingLevel(level);
    console.log(`[pi-bridge] Thinking: ${level}`);
  }

  /**
   * Get all available models (with configured auth).
   * Returns an array of { id, provider, name } for the widget.
   */
  getAvailableModels() {
    this.modelRegistry.refresh();
    return this.modelRegistry.getAvailable().map(m => ({
      id: `${m.provider}/${m.id}`,
      provider: m.provider,
      modelId: m.id,
      name: m.name || m.id,
      reasoning: m.reasoning || false,
    }));
  }

  /**
   * Get current model info.
   */
  getCurrentModel() {
    const m = this.session?.model;
    if (!m) return null;
    return {
      id: `${m.provider}/${m.id}`,
      provider: m.provider,
      modelId: m.id,
      name: m.name || m.id,
    };
  }

  /**
   * Get current thinking level.
   */
  getCurrentThinking() {
    return this.session?.thinkingLevel || "off";
  }

  /**
   * Whether the agent is currently streaming.
   */
  get isStreaming() {
    return this.session?.isStreaming || false;
  }

  /**
   * Get session file path.
   */
  get sessionFile() {
    return this.session?.sessionFile || null;
  }

  /**
   * Get session ID.
   */
  get sessionId() {
    return this.session?.sessionId || null;
  }

  // ──────────────────── Stats ────────────────────

  getStats() {
    if (!this.session) return null;
    return this.session.getSessionStats();
  }

  // ──────────────────── Cleanup ────────────────────

  async dispose() {
    await this._teardown();
  }
}
