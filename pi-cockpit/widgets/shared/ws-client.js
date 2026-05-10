/**
 * Shared WebSocket client for all PI Cockpit widgets.
 * Handles connection, reconnection, and message routing.
 *
 * Usage:
 *   import { connect } from "../shared/ws-client.js";
 *   const hub = connect("session-switcher");
 *   hub.on("session-changed", (data) => { ... });
 *   hub.send({ type: "switch-session", session: "..." });
 */

const DEFAULT_URL = `ws://${location.host}`;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

class HubClient {
  constructor(widgetName, url = DEFAULT_URL) {
    this.widgetName = widgetName;
    this.url = url;
    this.ws = null;
    this.listeners = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.state = null; // latest state snapshot from hub
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error(`[${this.widgetName}] Failed to create WebSocket:`, err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log(`[${this.widgetName}] Connected to hub`);

      // Identify to the hub
      this.ws.send(JSON.stringify({
        type: "identify",
        clientType: "widget",
        widgetName: this.widgetName,
      }));

      this.emit("connected", {});
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // Handle state sync specially
      if (msg.type === "state-sync") {
        this.state = msg;
      }

      // Emit to any listener for this message type
      this.emit(msg.type, msg);

      // Also emit to catch-all
      this.emit("*", msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log(`[${this.widgetName}] Disconnected`);
      this.emit("disconnected", {});
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error(`[${this.widgetName}] WebSocket error:`, err);
    };
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );
    console.log(`[${this.widgetName}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn(`[${this.widgetName}] Cannot send — not connected`);
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  off(type, callback) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  emit(type, data) {
    const list = this.listeners.get(type);
    if (list) {
      list.forEach(cb => {
        try { cb(data); } catch (err) { console.error(`[${this.widgetName}] Listener error:`, err); }
      });
    }
  }
}

/**
 * Create and connect a HubClient for a widget.
 */
export function connect(widgetName, url) {
  const client = new HubClient(widgetName, url);
  client.connect();
  return client;
}
