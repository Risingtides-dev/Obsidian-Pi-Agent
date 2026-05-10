/**
 * PI Cockpit — Obsidian Companion Plugin
 *
 * Connects to the PI Cockpit WebSocket hub (localhost:3099) and
 * executes layout commands using Obsidian's Workspace API.
 *
 * When the hub sends an "apply-layout" message, this plugin:
 *   1. Closes existing Custom Frame views
 *   2. Creates new splits with the specified widgets
 *   3. Opens each widget's URL in a Custom Frame pane
 *
 * Depends on: Custom Frames community plugin (ellpeck/ObsidianCustomFrames)
 */

import { Plugin, WorkspaceLeaf, Notice } from "obsidian";

const HUB_URL = "ws://localhost:3099";
const RECONNECT_DELAY = 3000;

interface LayoutPanel {
  widget: string;
  position: string;  // 'split-vertical' | 'split-horizontal' | 'right-sidebar' | 'left-sidebar'
  size?: number;
}

interface LayoutCommand {
  type: "apply-layout";
  layout: string;
  panels: LayoutPanel[];
}

export default class PiCockpitPlugin extends Plugin {
  ws: WebSocket | null = null;
  reconnectTimer: number | null = null;

  async onload() {
    console.log("[PI Cockpit] Plugin loaded");
    this.connect();
  }

  onunload() {
    this.disconnect();
    console.log("[PI Cockpit] Plugin unloaded");
  }

  // ── WebSocket ──────────────────────────────────────
  connect() {
    try {
      this.ws = new WebSocket(HUB_URL);
    } catch (err) {
      console.error("[PI Cockpit] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[PI Cockpit] Connected to hub");
      this.ws!.send(JSON.stringify({
        type: "identify",
        clientType: "plugin",
        widgetName: "obsidian-companion",
      }));
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "apply-layout") {
        this.applyLayout(msg);
      }
    };

    this.ws.onclose = () => {
      console.log("[PI Cockpit] Disconnected from hub");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("[PI Cockpit] WebSocket error:", err);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[PI Cockpit] Reconnecting in ${RECONNECT_DELAY}ms...`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  // ── Layout Application ─────────────────────────────
  async applyLayout(cmd: LayoutCommand) {
    console.log(`[PI Cockpit] Applying layout: ${cmd.layout}`, cmd.panels);
    new Notice(`PI Cockpit: ${cmd.layout} layout`);

    const { workspace } = this.app;

    // Close existing PI Cockpit Custom Frame views first
    workspace.getLeavesOfType("custom-frames").forEach(leaf => {
      const view = leaf.view as any;
      const displayText = view?.getDisplayText?.() || "";
      // Only close views that look like PI Cockpit widgets
      if (displayText.includes("PI Cockpit") ||
          displayText.includes("Session") ||
          displayText.includes("Vault Chat") ||
          displayText.includes("Skills") ||
          displayText.includes("Model")) {
        leaf.detach();
      }
    });

    // Open each panel
    for (let i = 0; i < cmd.panels.length; i++) {
      const panel = cmd.panels[i];
      const url = `http://localhost:3099/widget/${panel.widget}`;
      const title = this.getWidgetTitle(panel.widget);

      try {
        let leaf: WorkspaceLeaf;

        if (panel.position === "split-vertical") {
          leaf = workspace.getLeaf("split", "vertical");
        } else if (panel.position === "split-horizontal") {
          leaf = workspace.getLeaf("split", "horizontal");
        } else if (panel.position === "right-sidebar") {
          leaf = workspace.getRightLeaf(false)!;
        } else if (panel.position === "left-sidebar") {
          leaf = workspace.getLeftLeaf(false)!;
        } else {
          leaf = workspace.getLeaf("split", "vertical");
        }

        // Try to open as a Custom Frames view
        // This requires the Custom Frames plugin to be installed
        await leaf.openFile(url as any, { active: i === 0 });

      } catch (err) {
        console.error(`[PI Cockpit] Failed to open ${panel.widget}:`, err);
        // Fallback: try opening as a markdown file with an iframe embed
        new Notice(`Failed to open ${panel.widget}. Is Custom Frames installed?`);
      }
    }
  }

  getWidgetTitle(widget: string): string {
    const titles: Record<string, string> = {
      "session-switcher": "PI Sessions",
      "vault-chat": "Vault Chat",
      "skills-directory": "Skills",
      "model-switcher": "Model",
    };
    return titles[widget] || widget;
  }
}
