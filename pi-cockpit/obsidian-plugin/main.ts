/**
 * PI Cockpit — Obsidian Companion Plugin
 *
 * Connects to the PI Cockpit WebSocket hub (localhost:3099).
 * Opens widget panes in Obsidian using a custom iframe view.
 */

import { Plugin, ItemView, WorkspaceLeaf, Notice } from "obsidian";

const HUB_URL = "ws://localhost:3099";
const VIEW_TYPE_PREFIX = "pi-cockpit-widget";

const WIDGETS: Record<string, { url: string; mode: string; displayName: string }> = {
  "session-switcher": {
    url: "http://localhost:3099/widget/session-switcher",
    mode: "sidebar",
    displayName: "PI Sessions",
  },
  "vault-chat": {
    url: "http://localhost:3099/widget/vault-chat",
    mode: "tab",
    displayName: "Vault Chat",
  },
  "skills-directory": {
    url: "http://localhost:3099/widget/skills-directory",
    mode: "tab",
    displayName: "Skills",
  },
  "model-switcher": {
    url: "http://localhost:3099/widget/model-switcher",
    mode: "tab",
    displayName: "Model",
  },
};

class WidgetView extends ItemView {
  url: string;
  _displayName: string;

  constructor(leaf: WorkspaceLeaf, url: string, displayName: string) {
    super(leaf);
    this.url = url;
    this._displayName = displayName;
  }

  getViewType(): string {
    return VIEW_TYPE_PREFIX;
  }

  getDisplayText(): string {
    return this._displayName || "PI Cockpit";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.padding = "0";
    container.style.overflow = "hidden";

    const iframe = container.createEl("iframe", {
      attr: {
        src: this.url,
        sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
      },
    });
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
  }

  async onClose() {}
}

export default class PiCockpitPlugin extends Plugin {
  ws: WebSocket | null = null;
  reconnectTimer: number | null = null;

  async onload() {
    console.log("[PI Cockpit] Plugin loaded");

    this.registerView(
      VIEW_TYPE_PREFIX,
      (leaf) => new WidgetView(leaf, "", "PI Cockpit")
    );

    this.connect();
  }

  onunload() {
    this.disconnect();
  }

  connect() {
    try { this.ws = new WebSocket(HUB_URL); } catch { this.scheduleReconnect(); return; }

    this.ws.onopen = () => {
      console.log("[PI Cockpit] Connected to hub");
      this.ws!.send(JSON.stringify({ type: "identify", clientType: "plugin", widgetName: "obsidian-companion" }));
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "open-widget") {
        this.openWidget(msg.widget);
      }
    };

    this.ws.onclose = () => { this.scheduleReconnect(); };
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 3000);
  }

  async openWidget(widgetName: string) {
    const cfg = WIDGETS[widgetName];
    if (!cfg) {
      new Notice(`Unknown widget: ${widgetName}`);
      return;
    }

    const { workspace } = this.app;
    let leaf: WorkspaceLeaf;

    try {
      if (cfg.mode === "sidebar") {
        leaf = workspace.getRightLeaf(false) as WorkspaceLeaf;
        if (!leaf) {
          leaf = workspace.getLeaf("split", "vertical");
        }
      } else {
        leaf = workspace.getLeaf("tab");
      }

      await leaf.setViewState({
        type: VIEW_TYPE_PREFIX,
        active: true,
        state: { url: cfg.url, displayName: cfg.displayName },
      });

      const view = leaf.view as WidgetView;
      if (view) {
        view.url = cfg.url;
        view._displayName = cfg.displayName;
        await view.onOpen();
      }

      new Notice(`Opened ${cfg.displayName}`);
    } catch (err) {
      console.error(`[PI Cockpit] Failed to open ${widgetName}:`, err);
      new Notice(`Failed to open ${cfg.displayName}`);
    }
  }
}
