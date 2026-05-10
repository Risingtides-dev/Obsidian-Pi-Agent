/**
 * Obsidian bridge — layout commands and REST API integration.
 *
 * The hub doesn't control Obsidian directly. Instead:
 * - Layout commands are sent to the companion Obsidian plugin via WebSocket
 * - Vault read/write goes through Obsidian's Local REST API (localhost:27124)
 */

import { state, getSnapshot } from "./state.js";

/**
 * Layout presets. Each defines which widgets to open and where.
 *
 * Positions use Obsidian workspace terminology:
 *   'split-vertical'   = split right of active leaf
 *   'split-horizontal' = split below active leaf
 *   'right-sidebar'    = right sidebar leaf
 *   'left-sidebar'     = left sidebar leaf
 */
export const LAYOUTS = {
  coding: {
    name: "Coding",
    description: "Session switcher right, Chat bottom",
    panels: [
      { widget: "session-switcher", position: "split-vertical", size: 280 },
      { widget: "vault-chat", position: "split-horizontal", size: 300 },
    ],
  },
  writing: {
    name: "Writing",
    description: "Chat right, Skills bottom",
    panels: [
      { widget: "vault-chat", position: "split-vertical", size: 400 },
      { widget: "skills-directory", position: "split-horizontal", size: 250 },
    ],
  },
  minimal: {
    name: "Minimal",
    description: "Just Chat, full width",
    panels: [
      { widget: "vault-chat", position: "split-vertical", size: 500 },
    ],
  },
  full: {
    name: "Full Cockpit",
    description: "All widgets arranged",
    panels: [
      { widget: "session-switcher", position: "split-vertical", size: 250 },
      { widget: "skills-directory", position: "split-vertical", size: 250 },
      { widget: "vault-chat", position: "split-horizontal", size: 350 },
      { widget: "model-switcher", position: "split-vertical", size: 200 },
    ],
  },
};

/**
 * Get a layout by name.
 */
export function getLayout(name) {
  return LAYOUTS[name] || null;
}

/**
 * Get all available layout names and descriptions.
 */
export function listLayouts() {
  return Object.entries(LAYOUTS).map(([key, layout]) => ({
    id: key,
    name: layout.name,
    description: layout.description,
    panelCount: layout.panels.length,
  }));
}
