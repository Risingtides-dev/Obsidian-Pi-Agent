/**
 * PI Cockpit — Obsidian Companion Plugin (native ItemView edition)
 *
 * NOTE: This file is informational. The deployed plugin is main.js (CJS, hand-
 * written). Keep this file in sync when making semantic changes — but main.js is
 * the source of truth. No build step.
 *
 * Architecture:
 *   - One shared HubClient (WebSocket to ws://localhost:3099)
 *   - Four ItemViews registered with Obsidian: sessions, chat, skills, model
 *   - Views render directly into this.contentEl using Obsidian CSS variables
 *   - No iframes, no Custom Frames, no theme bridge
 *   - Cross-view widget opens go through plugin.openWidget(name)
 */
export {};
