/**
 * Shared state managed by the WebSocket hub.
 * All widgets read/write through this, and changes are broadcast.
 */

export const state = {
  /** Currently active PI session (directory name under ~/.pi/agent/sessions/) */
  currentSession: null,

  /** Active model config */
  currentModel: "deepseek-v4-pro",
  currentThinkingLevel: "high",

  /** Current Obsidian layout (null = no layout applied) */
  currentLayout: null,

  /** Set of currently connected widget client IDs */
  connectedWidgets: new Set(),

  /** Is the companion Obsidian plugin connected? */
  obsidianPluginConnected: false,

  /** All known PI sessions (refreshed from disk) */
  sessions: [],

  /** All known skills */
  skills: [],

  /** All known MCP servers */
  mcpServers: [],
};

/**
 * Build a snapshot of current state to send to newly connected clients.
 */
export function getSnapshot() {
  return {
    currentSession: state.currentSession,
    currentModel: state.currentModel,
    currentThinkingLevel: state.currentThinkingLevel,
    currentLayout: state.currentLayout,
    obsidianPluginConnected: state.obsidianPluginConnected,
    sessions: state.sessions,
    skills: state.skills,
    mcpServers: state.mcpServers,
    widgetCount: state.connectedWidgets.size,
  };
}

/**
 * Get summary of a specific session (line count, last activity, etc.)
 */
export function getSessionSummary(sessionDir) {
  const session = state.sessions.find(s => s.name === sessionDir);
  return session || null;
}
