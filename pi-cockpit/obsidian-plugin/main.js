"use strict";
/**
 * PI Cockpit — Obsidian Companion Plugin (native ItemView edition)
 *
 * Renders all four widgets as native Obsidian ItemViews. No iframes, no
 * Custom Frames dependency. Widgets inherit Obsidian's theme automatically
 * because they live in the same DOM.
 *
 * One shared WebSocket connection to the hub (localhost:3099), multiplexed
 * to all open views via an event bus.
 */

const obsidian = require("obsidian");

const HUB_URL = "ws://localhost:3099";

// ───────────────────────── Phosphor Icons ─────────────────────────
// Inline SVG icon system. Zero deps, zero network, theme-aware via currentColor.

const ICON_PATHS = {
  // Navigation / structure
  "folder":        "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z",
  "folder-open":   "M245,110.64A16,16,0,0,0,232,104H216V88a16,16,0,0,0-16-16H130.67L102.94,51.2a16.14,16.14,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V208h0a8,8,0,0,0,8,8H211.1a8,8,0,0,0,7.59-5.47l28.49-85.47A16.05,16.05,0,0,0,245,110.64ZM93.34,64,123.2,86.4A8,8,0,0,0,128,88h72v16H69.77a16,16,0,0,0-15.18,10.94L40,158.7V64Zm112,136H43.1l26.67-80H232Z",
  "package":       "M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z",
  "cube":          "M223.68,66.15,135.68,18h0a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32h0l80.34,44L128,120,47.66,76ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z",
  "plug":          "M237.66,66.34a8,8,0,0,0-11.32,0L192,100.69,155.31,64l34.35-34.34a8,8,0,1,0-11.32-11.32L144,52.69,117.66,26.34a8,8,0,0,0-11.32,11.32L112.69,44l-53,53a40,40,0,0,0,0,56.57l15.71,15.71L26.34,218.34a8,8,0,0,0,11.32,11.32l49.09-49.09,15.71,15.71a40,40,0,0,0,56.57,0l53-53,6.34,6.35a8,8,0,0,0,11.32-11.32L203.31,112l34.35-34.34A8,8,0,0,0,237.66,66.34ZM147.72,185a24,24,0,0,1-33.95,0L71,142.23a24,24,0,0,1,0-33.95l53-53L200.69,132Z",
  "sliders":       "M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H199a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h97a32,32,0,0,0,62,0h17a8,8,0,0,0,0-16Zm-48,24a16,16,0,1,1,16-16A16,16,0,0,1,168,192Z",
  "gear":          "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z",
  // Chat / messaging
  "chat-centered": "M88,104a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,104Zm8,40h64a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16ZM232,56V184a16,16,0,0,1-16,16H155.57l-13.68,23.94a16,16,0,0,1-27.78,0L100.43,200H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Zm-16,0H40V184h65.07a8,8,0,0,1,7,4l16,28,16-28a8,8,0,0,1,7-4H216Z",
  "paper-plane":   "M231.87,114l-168-95.89A16,16,0,0,0,40.92,37.34L71.55,128,40.92,218.67A16,16,0,0,0,56,240a16.15,16.15,0,0,0,7.93-2.1l167.92-96.05a16,16,0,0,0,.05-27.89ZM56,224a.56.56,0,0,0,0-.12L85.74,136H144a8,8,0,0,0,0-16H85.74L56.06,32.16A.46.46,0,0,0,56,32l168,95.83Z",
  // Actions
  "magnifying-glass": "M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z",
  "copy":          "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z",
  "stop-circle":   "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM160,88H96a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V96A8,8,0,0,0,160,88Zm-8,64H104V104h48Z",
  "arrow-clockwise": "M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z",
  "sparkle":       "M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z",
  "robot":         "M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16Zm-52-56H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Z",
  "brain":         "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z",
  "git-branch":    "M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192ZM200,80a16,16,0,1,1,16-16A16,16,0,0,1,200,80Z",
  "user-circle":   "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120Zm97.76,66.41a79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75,88,88,0,1,1,131.52,0Z",
  "code":          "M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z",
  "terminal":      "M117.31,134l-72,64a8,8,0,1,1-10.63-12L100,128,34.69,70A8,8,0,1,1,45.32,58l72,64a8,8,0,0,1,0,12ZM216,184H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16Z",
  // UI elements
  "caret-down":    "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z",
  "caret-right":   "M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z",
  "dots-three":    "M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z",
  "check-circle":  "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
  "x-circle":      "M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
  "warning-circle":"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z",
  "circle":        "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z",
  "file-text":     "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z",
  "clock":         "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z",
  "info":          "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z",
  "heart-pulse":   "M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,20.65,8.42,42.71,25,65.59l4.61,6.21A8,8,0,0,0,52,177h41.74L116,210.4a8,8,0,0,0,13.86-.74L154.47,159l13,19.55a8,8,0,0,0,6.66,3.57h32.07a8,8,0,0,0,6.4-3.2C233.61,154.05,240,134.85,240,118A62.07,62.07,0,0,0,178,40ZM202.4,166.11H178.45l-17.79-26.71a8,8,0,0,0-14-.84l-23.81,48.6L106.66,160.6A8,8,0,0,0,100,157H56.06l-2.39-3.22C39,134.07,32,116,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,121,217.84,142.58,202.4,166.11Z",
  "play":          "M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z",
  "pause":         "M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z",
  "pencil":        "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z",
  "trash":         "M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z",
  "plus":          "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z",
  "list":          "M40,128a8,8,0,0,1,8-8H208a8,8,0,0,1,0,16H48A8,8,0,0,1,40,128ZM48,72H208a8,8,0,0,0,0-16H48a8,8,0,0,0,0,16ZM208,184H48a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16Z",
};

/**
 * Create a Phosphor icon SVG element inside the given container.
 * @param {HTMLElement} container - Element to append icon into
 * @param {string} name - Icon name from ICON_PATHS
 * @param {number} [size=16] - Icon size in pixels
 * @returns {HTMLElement} The SVG element (wrapped in a span)
 */
function phosphorIcon(container, name, size) {
  const path = ICON_PATHS[name];
  if (!path) { container.setText(name); return container; }
  size = size || 16;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("fill", "currentColor");
  svg.style.display = "block";
  svg.style.flexShrink = "0";
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  container.appendChild(svg);
  return svg;
}

/**
 * Create a span with a Phosphor icon. Convenience wrapper.
 * @param {string} name
 * @param {number} [size=16]
 * @returns {HTMLElement}
 */
function iconEl(name, size) {
  const span = document.createElement("span");
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  phosphorIcon(span, name, size);
  return span;
}
const RECONNECT_DELAY = 3000;
const QUEUE_MAX = 25;
const SAFE_TYPES = new Set([
  "refresh-daemons",
  "refresh-routines",
  "refresh-skills",
  "tickets-refresh",
  "ticket-get",
  "get-routine",
  "view-daemon-log",
  "get-session-stats",
  "copy-skill",
  "copy-mcp",
]);

const VIEW_SESSIONS = "pi-cockpit-sessions";
const VIEW_CHAT     = "pi-cockpit-chat";
const VIEW_SKILLS   = "pi-cockpit-skills";
const VIEW_MODEL    = "pi-cockpit-model";
const VIEW_CRON     = "pi-cockpit-cron";
const VIEW_TICKETS  = "pi-cockpit-tickets";

const WIDGET_TO_VIEW = {
  "session-switcher":  VIEW_SESSIONS,
  "vault-chat":        VIEW_CHAT,
  "skills-directory":  VIEW_SKILLS,
  "model-switcher":    VIEW_MODEL,
  "cron-dashboard":    VIEW_CRON,
  "tickets":           VIEW_TICKETS,
};

// ───────────────────────── HubClient (shared, single connection) ─────────────────────────

class HubClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.listeners = new Map();   // type → Set<cb>
    this.reconnectTimer = null;
    this.state = {};              // last state-sync snapshot
    this._queue = [];             // bounded safe-message queue for pre-connect sends
  }

  connect() {
    try {
      this.ws = new WebSocket(HUB_URL);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.ws.send(JSON.stringify({
        type: "identify",
        clientType: "plugin",
        widgetName: "obsidian-native",
      }));
      // Flush any queued safe messages (refresh/get/copy) that arrived before connect.
      if (this._queue.length) {
        const pending = this._queue.splice(0);
        for (const m of pending) {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(m));
          }
        }
      }
      this.emit("connected", {});
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "state-sync") this.state = msg;
      this.emit(msg.type, msg);
      this.emit("*", msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._queue = [];  // discard stale queue on disconnect
      this.emit("disconnected", {});
      this.scheduleReconnect();
    };

    this.ws.onerror = () => { /* swallow — onclose handles reconnect */ };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (SAFE_TYPES.has(msg.type) && this._queue.length < QUEUE_MAX) {
      // Queue safe refresh/get/copy messages until connected.
      // Destructive/action messages are deliberately dropped — replay is unsafe.
      this._queue.push(msg);
    }
  }

  on(type, cb) {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(cb);
    return () => set.delete(cb);   // returns unsubscribe
  }

  emit(type, data) {
    const set = this.listeners.get(type);
    if (set) for (const cb of set) { try { cb(data); } catch (e) { console.error(e); } }
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.connected = false;
  }
}

// ───────────────────────── Shared styles (injected once) ─────────────────────────

const STYLE_ID = "pi-cockpit-styles";
const STYLES = `
.pi-cockpit-root {
  display: flex; flex-direction: column; height: 100%;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}
.pi-cockpit-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.pi-cockpit-title {
  font-weight: 600; font-size: var(--font-ui-small);
  color: var(--text-normal); text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pi-cockpit-subtitle {
  font-size: var(--font-ui-smaller); color: var(--text-muted);
}
.pi-cockpit-body { flex: 1; overflow-y: auto; }
.pi-cockpit-footer {
  border-top: 1px solid var(--background-modifier-border);
  padding: 6px 12px;
  font-size: var(--font-ui-smaller); color: var(--text-faint);
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}
.pi-cockpit-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-faint); flex-shrink: 0;
}
.pi-cockpit-dot.connected { background: var(--color-green); }

/* List items */
.pi-cockpit-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; cursor: pointer;
  border-left: 2px solid transparent;
  transition: background-color 80ms ease;
}
.pi-cockpit-item:hover { background: var(--background-modifier-hover); }
.pi-cockpit-item.active {
  background: var(--background-modifier-active-hover);
  border-left-color: var(--interactive-accent);
}
.pi-cockpit-item-icon { font-size: 16px; opacity: 0.85; flex-shrink: 0; }
.pi-cockpit-item-main { flex: 1; min-width: 0; }
.pi-cockpit-item-title {
  font-size: var(--font-ui-small); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-normal);
}
.pi-cockpit-item.active .pi-cockpit-item-title { color: var(--interactive-accent); }
.pi-cockpit-item-sub {
  font-size: var(--font-ui-smaller);
  line-height: 1.45;
  color: var(--text-muted);
  white-space: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  font-family: var(--font-interface);
}
.pi-cockpit-item-meta {
  display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
  flex-shrink: 0;
}
.pi-cockpit-chip {
  font-size: 10px; padding: 1px 6px; border-radius: 10px;
  background: var(--background-modifier-hover); color: var(--text-muted);
  font-family: var(--font-monospace);
}
.pi-cockpit-chip-inset {
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-normal);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.pi-cockpit-time { font-size: var(--font-ui-smaller); color: var(--text-faint); }

/* Sessions: project row + nested children */
.pi-cockpit-project {
  /* Slightly heavier than a leaf row */
}
.pi-cockpit-chevron {
  width: 16px;
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  padding: 2px 0;
  border-radius: 3px;
}
.pi-cockpit-chevron:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}
.pi-cockpit-child-list {
  background: var(--background-secondary);
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-cockpit-child {
  padding-left: 28px;
  padding-top: 5px;
  padding-bottom: 5px;
  position: relative;
}
.pi-cockpit-child .pi-cockpit-item-icon {
  font-size: 11px; opacity: 0.5;
}
.pi-cockpit-child .pi-cockpit-item-title {
  font-size: var(--font-ui-smaller);
  font-family: var(--font-monospace);
  font-weight: 400;
}
.pi-cockpit-child-rail {
  position: absolute;
  left: 18px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--background-modifier-border);
}

/* Empty */
.pi-cockpit-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 20px; color: var(--text-muted); text-align: center; height: 100%;
}
.pi-cockpit-empty-icon { font-size: 28px; margin-bottom: 12px; opacity: 0.4; }

/* Segmented tabs / inlaid controls */
.pi-cockpit-tabs {
  display: flex;
  gap: 4px;
  margin: 8px 12px;
  padding: 4px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
  flex-shrink: 0;
}
.pi-cockpit-tab {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  text-align: center;
  font-size: var(--font-ui-small);
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  transition: all 80ms ease;
}
.pi-cockpit-tab:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}
.pi-cockpit-tab.active {
  color: var(--text-normal);
  background: var(--background-primary);
  border-color: var(--background-modifier-border);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.pi-cockpit-search {
  margin: 8px 12px;
  padding: 6px 10px;
  width: calc(100% - 24px);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-family: inherit;
  outline: none;
}
.pi-cockpit-search:focus { border-color: var(--interactive-accent); }

/* Model view */
.pi-cockpit-section-header {
  padding: 10px 12px 4px;
  font-size: var(--font-ui-smaller); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text-muted);
}
.pi-cockpit-thinking {
  display: flex;
  gap: 4px;
  margin: 0 12px 8px;
  padding: 4px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
}
.pi-cockpit-thinking-option {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  text-align: center;
  font-size: var(--font-ui-small);
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 80ms ease;
}
.pi-cockpit-thinking-option:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.pi-cockpit-thinking-option.active {
  background: var(--background-primary);
  border-color: var(--background-modifier-border);
  color: var(--text-normal);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}

/* Chat — transcript layout (no bubbles) */
.pi-cockpit-chat-messages {
  flex: 1; overflow-y: auto;
  padding: 4px 0 12px 0;
  display: flex; flex-direction: column;
  scroll-behavior: smooth;
}
.pi-cockpit-launch-row {
  display: flex;
  gap: 4px;
  margin: 8px 12px;
  padding: 4px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
  flex-wrap: wrap;
}
.pi-cockpit-launch-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 calc(33.333% - 4px);
  min-width: 92px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  cursor: pointer;
  transition: all 80ms ease;
}
.pi-cockpit-launch-btn:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
  border-color: var(--background-modifier-border);
}
.pi-cockpit-chat-input-row {
  display: flex; gap: 6px; padding: 8px 10px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  flex-shrink: 0;
}
.pi-cockpit-chat-input {
  flex: 1; resize: none;
  padding: 6px 10px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: inherit;
  font-size: var(--font-ui-small);
  outline: none;
  min-height: 32px; max-height: 120px;
}
.pi-cockpit-chat-input:focus { border-color: var(--interactive-accent); }
.pi-cockpit-send-btn {
  padding: 6px 12px; border-radius: 8px; border: none;
  background: var(--interactive-accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 100ms ease;
  min-width: 36px;
}
.pi-cockpit-send-btn:hover { background: var(--interactive-accent-hover); }
.pi-cockpit-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Transcript turns */
.pi-cockpit-turn {
  display: grid;
  grid-template-columns: 3px 1fr;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-cockpit-turn:last-child { border-bottom: none; }
.pi-cockpit-turn-rail {
  background: var(--background-modifier-border);
  border-radius: 1px;
  align-self: stretch;
}
.pi-cockpit-turn.user .pi-cockpit-turn-rail {
  background: var(--interactive-accent);
}
.pi-cockpit-turn.assistant.streaming .pi-cockpit-turn-rail {
  background: var(--interactive-accent);
}
.pi-cockpit-turn-body {
  min-width: 0; /* let pre blocks shrink instead of overflowing the grid track */
  display: flex; flex-direction: column; gap: 4px;
}
.pi-cockpit-turn-role {
  font-family: var(--font-monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-faint);
  display: flex; align-items: center; gap: 8px;
}
.pi-cockpit-turn-role .pi-cockpit-role-name { color: var(--text-muted); }
.pi-cockpit-turn-role .pi-cockpit-role-meta { color: var(--text-faint); font-weight: 500; text-transform: none; letter-spacing: 0; }
.pi-cockpit-turn.user .pi-cockpit-turn-role .pi-cockpit-role-name { color: var(--interactive-accent); }
.pi-cockpit-turn-text {
  font-size: var(--font-ui-small);
  line-height: 1.6;
  color: var(--text-normal);
}
.pi-cockpit-turn.user .pi-cockpit-turn-text,
.pi-cockpit-turn.user .pi-cockpit-turn-text p {
  color: var(--interactive-accent);
  font-weight: 600;
}
.pi-cockpit-turn-system {
  padding: 4px 14px;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  font-style: italic;
  text-align: center;
}

/* Origin badge on user messages from other clients */
.pi-cockpit-origin-badge {
  display: inline-block;
  padding: 1px 6px;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-radius: 4px;
  background: var(--background-modifier-hover);
  color: var(--text-faint);
}
.pi-cockpit-chat-msg.user .pi-cockpit-origin-badge {
  background: rgba(255,255,255,0.15);
  color: var(--text-on-accent);
}

/* Activity strip (thinking + tools) — lives under role, above text */
.pi-cockpit-activity {
  margin: 2px 0 4px 0;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-secondary);
  overflow: hidden;
}
.pi-cockpit-activity-header {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  background: transparent;
  transition: background 100ms ease;
}
.pi-cockpit-activity-header:hover { background: var(--background-modifier-hover); }
.pi-cockpit-activity-summary { color: var(--text-faint); font-weight: 500; }
.pi-cockpit-activity-caret { margin-left: auto; color: var(--text-faint); }
.pi-cockpit-activity-body {
  display: none;
  padding: 4px 8px 8px 8px;
  border-top: 1px solid var(--background-modifier-border);
}
.pi-cockpit-activity.open .pi-cockpit-activity-body { display: block; }
.pi-cockpit-activity.open .pi-cockpit-activity-caret { transform: rotate(90deg); }

/* Thinking block inside activity */
.pi-cockpit-thinking-block {
  margin: 4px 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  white-space: pre-wrap;
  line-height: 1.5;
  max-height: 240px;
  overflow-y: auto;
}
.pi-cockpit-thinking-block::before {
  content: "thinking";
  display: block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 4px;
}

/* Tool calls inside activity */
.pi-cockpit-tool {
  margin: 4px 0;
  border-radius: 4px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  font-size: var(--font-ui-smaller);
  overflow: hidden;
}
.pi-cockpit-tool-header {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  color: var(--text-muted);
  cursor: pointer;
}
.pi-cockpit-tool-name {
  color: var(--text-accent);
  font-weight: 600;
  font-family: var(--font-monospace);
}
.pi-cockpit-tool-status {
  font-size: 10px;
  margin-left: auto;
  font-family: var(--font-monospace);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.pi-cockpit-tool-status.running { color: var(--color-orange); }
.pi-cockpit-tool-status.done    { color: var(--color-green); }
.pi-cockpit-tool-status.error   { color: var(--color-red); }
.pi-cockpit-tool-output {
  padding: 4px 8px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  white-space: pre-wrap; word-break: break-all;
  max-height: 220px; overflow-y: auto;
  display: none;
}
.pi-cockpit-tool-output.open { display: block; }

/* Markdown rendered inside transcript text */
.pi-cockpit-turn-text > *:first-child { margin-top: 0; }
.pi-cockpit-turn-text > *:last-child  { margin-bottom: 0; }
.pi-cockpit-turn-text p { margin: 0 0 8px 0; }
.pi-cockpit-turn-text ul,
.pi-cockpit-turn-text ol { margin: 4px 0 8px 0; padding-left: 22px; }
.pi-cockpit-turn-text li { margin: 2px 0; }
.pi-cockpit-turn-text h1,
.pi-cockpit-turn-text h2,
.pi-cockpit-turn-text h3,
.pi-cockpit-turn-text h4 {
  margin: 10px 0 4px 0;
  font-weight: 700;
  line-height: 1.3;
}
.pi-cockpit-turn-text h1 { font-size: 1.25em; }
.pi-cockpit-turn-text h2 { font-size: 1.15em; }
.pi-cockpit-turn-text h3 { font-size: 1.05em; }
.pi-cockpit-turn-text h4 { font-size: 1em; }
.pi-cockpit-turn-text code {
  font-family: var(--font-monospace);
  font-size: 0.88em;
  background: var(--background-modifier-hover);
  padding: 1px 5px;
  border-radius: 3px;
}
.pi-cockpit-turn-text pre {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  overflow-x: auto;
}
.pi-cockpit-turn-text pre code {
  background: transparent;
  padding: 0;
  font-size: var(--font-ui-smaller);
  white-space: pre;
}
.pi-cockpit-turn-text blockquote {
  margin: 6px 0;
  padding: 2px 10px;
  border-left: 3px solid var(--background-modifier-border);
  color: var(--text-muted);
}
.pi-cockpit-turn-text a { color: var(--text-accent); }

@keyframes pi-cockpit-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50%      { opacity: 1;   transform: scale(1.2); }
}
.pi-cockpit-msg-streaming-caret {
  display: inline-block;
  width: 6px; height: 6px;
  margin-left: 3px;
  border-radius: 50%;
  background: var(--interactive-accent);
  vertical-align: middle;
  animation: pi-cockpit-pulse 1.2s ease-in-out infinite;
}
.pi-cockpit-session-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  font-size: var(--font-ui-smaller); color: var(--text-muted);
  background: var(--background-primary);
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-cockpit-session-name {
  color: var(--interactive-accent); font-weight: 600;
  font-family: var(--font-interface);
}

/* ── Shared header right-side action button (e.g. + on Sessions) ── */
.pi-cockpit-header-right {
  display: flex; align-items: center; gap: 8px;
}
.pi-cockpit-header-btn {
  background: transparent; border: 1px solid var(--background-modifier-border);
  color: var(--text-muted); cursor: pointer;
  width: 24px; height: 24px; padding: 0; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
}
.pi-cockpit-header-btn:hover {
  color: var(--text-normal); border-color: var(--text-muted);
  background: var(--background-modifier-hover);
}

/* ── New-session sheet: recent projects + row-field hint ── */
.pi-cron-recent-list {
  display: flex; flex-direction: column;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  overflow: hidden;
}
.pi-cron-recent-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; cursor: pointer;
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-cron-recent-row:last-child { border-bottom: 0; }
.pi-cron-recent-row:hover { background: var(--background-modifier-hover); }
.pi-cron-recent-icon { color: var(--text-muted); flex-shrink: 0; }
.pi-cron-recent-main { flex: 1; min-width: 0; }
.pi-cron-recent-title {
  font-size: var(--font-ui-small); color: var(--text-normal);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pi-cron-recent-sub {
  font-size: var(--font-ui-smaller); color: var(--text-muted);
  font-family: var(--font-monospace); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pi-cron-row-field {
  flex-direction: row; align-items: center; gap: 10px;
}
.pi-cron-row-field > label { min-width: 110px; }
.pi-cron-field-hint {
  color: var(--text-muted); font-size: var(--font-ui-smaller);
}

/* ── Telegram badge in Vault Chat header ── */
.pi-cockpit-telegram-badge {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: var(--font-ui-smaller);
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 80ms ease;
}
.pi-cockpit-telegram-badge:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.pi-cockpit-telegram-badge.connected {
  color: var(--text-normal);
  background: var(--background-primary);
  border-color: var(--background-modifier-border);
}
.pi-cockpit-telegram-badge .pi-cockpit-dot { width: 7px; height: 7px; border-radius: 2px; background: var(--text-faint); }
.pi-cockpit-telegram-badge.connected .pi-cockpit-dot { background: var(--interactive-accent); }

/* ── Chat token/cost footer ── */
.pi-cockpit-stats-bar {
  display: flex; align-items: center; gap: 14px;
  padding: 4px 12px;
  font-size: 10px; color: var(--text-muted);
  font-family: var(--font-monospace);
  background: var(--background-secondary);
  border-top: 1px solid var(--background-modifier-border);
}
.pi-cockpit-stats-bar .pi-cockpit-stat { white-space: nowrap; }
.pi-cockpit-stats-bar .pi-cockpit-stat-label { opacity: 0.7; margin-right: 4px; }
.pi-cockpit-stats-bar .pi-cockpit-stat-val { color: var(--text-normal); }


/* ── Tickets view: native Obsidian theme surface ── */
.pi-tickets-toolbar {
  display: flex; gap: 8px; align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  flex-shrink: 0;
}
.pi-tickets-toolbar .pi-cockpit-search {
  margin: 0; width: auto; flex: 1;
}
.pi-tickets-select {
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  padding: 6px 8px;
  max-width: 160px;
}
.pi-tickets-list .pi-cockpit-item {
  padding: 12px 14px;
  gap: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-tickets-list .pi-cockpit-item:last-child { border-bottom: 0; }
.pi-tickets-list .pi-cockpit-item-title {
  font-size: var(--font-ui-medium);
  margin-bottom: 4px;
}
.pi-tickets-list .pi-cockpit-item-sub {
  font-size: var(--font-ui-smaller);
  line-height: 1.45;
  white-space: normal;
  font-family: var(--font-interface);
}
.pi-tickets-group-header {
  padding: 10px 14px 5px;
  font-size: var(--font-ui-smaller);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--background-secondary);
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-tickets-board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(240px, 1fr);
  gap: 10px;
  padding: 10px;
  overflow-x: auto;
  height: 100%;
}
.pi-tickets-column {
  min-width: 240px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.pi-tickets-column-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.pi-tickets-card {
  margin: 8px;
  padding: 10px;
  border-radius: 7px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.pi-tickets-card:hover { background: var(--background-modifier-hover); }
.pi-tickets-card-title {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: 600;
  line-height: 1.35;
  margin-bottom: 8px;
}
.pi-tickets-card-meta {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.pi-ticket-desc {
  color: var(--text-normal);
  line-height: 1.55;
  white-space: pre-wrap;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 12px;
  font-size: var(--font-ui-small);
}
.pi-ticket-comment-list, .pi-ticket-history-list {
  display: flex; flex-direction: column; gap: 8px;
}
.pi-ticket-comment, .pi-ticket-history-row {
  padding: 10px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}
.pi-ticket-comment-meta, .pi-ticket-history-meta {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  margin-bottom: 4px;
}

/* ── Cron view: looser row spacing ── */
.pi-cron-list .pi-cockpit-item {
  padding: 14px 14px;
  gap: 14px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.pi-cron-list .pi-cockpit-item:last-child { border-bottom: 0; }
.pi-cron-list .pi-cockpit-item-icon { font-size: 18px; }
.pi-cron-list .pi-cockpit-item-title {
  font-size: var(--font-ui-medium);
  margin-bottom: 4px;
}
.pi-cron-list .pi-cockpit-item-sub {
  font-size: var(--font-ui-smaller);
  line-height: 1.5;
  white-space: normal;
  font-family: var(--font-interface);
}
.pi-cron-list .pi-cockpit-item-meta { gap: 4px; }

/* Tabs strip inside cron gets a little more breathing room */
.pi-cron-list-wrapper .pi-cockpit-tabs {
  padding: 4px 0;
}

/* ── Cron view: sheet & form fields ── */
.pi-cron-sheet {
  position: absolute; inset: 0;
  background: var(--background-primary);
  display: flex; flex-direction: column;
  z-index: 10;
}
.pi-cron-sheet-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}
.pi-cron-sheet-title {
  font-weight: 600;
  font-size: var(--font-ui-medium);
  color: var(--text-normal);
}
.pi-cron-sheet-close {
  background: transparent; border: 0; color: var(--text-muted);
  cursor: pointer; font-size: 22px; line-height: 1;
  width: 28px; height: 28px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
}
.pi-cron-sheet-close:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.pi-cron-sheet-body {
  flex: 1; overflow-y: auto;
  padding: 20px;
  display: flex; flex-direction: column; gap: 20px;
}
.pi-cron-sheet-foot {
  display: flex; gap: 8px; flex-wrap: wrap;
  padding: 14px 20px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}
.pi-cron-sheet-foot .pi-cron-spacer { flex: 1; }
.pi-cron-sheet-foot button {
  padding: 6px 14px; font-size: var(--font-ui-small);
  background: var(--interactive-normal);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  color: var(--text-normal); cursor: pointer;
  transition: background-color 80ms ease;
}
.pi-cron-sheet-foot button:hover { background: var(--interactive-hover); }
.pi-cron-sheet-foot button.pi-cron-primary {
  background: var(--interactive-accent);
  border-color: var(--interactive-accent);
  color: var(--text-on-accent);
}
.pi-cron-sheet-foot button.pi-cron-primary:hover { background: var(--interactive-accent-hover); }
.pi-cron-sheet-foot button.pi-cron-danger {
  color: var(--text-error, var(--color-red));
  border-color: var(--background-modifier-border);
}
.pi-cron-sheet-foot button.pi-cron-danger:hover {
  background: var(--background-modifier-error, rgba(255,80,80,0.1));
}

.pi-action-status {
  display: inline-flex;
  align-items: center;
  margin-right: auto;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
.pi-action-status:empty { display: none; }
.pi-action-status.is-pending { color: var(--text-muted); }
.pi-action-status.is-success { color: var(--text-success, var(--color-green)); }
.pi-action-status.is-error { color: var(--text-error, var(--color-red)); }

.pi-cron-field { display: flex; flex-direction: column; gap: 6px; }
.pi-cron-field label {
  font-size: var(--font-ui-smaller);
  text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--text-muted);
}
.pi-cron-field input, .pi-cron-field textarea, .pi-cron-field select {
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  font-family: var(--font-interface);
}
.pi-cron-field input:focus, .pi-cron-field textarea:focus, .pi-cron-field select:focus {
  border-color: var(--interactive-accent); outline: none;
}
.pi-cron-field textarea {
  font-family: var(--font-monospace);
  resize: vertical; min-height: 140px;
  line-height: 1.5;
}

/* Read-only metadata grid (daemon detail) */
.pi-cron-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 14px;
  align-items: baseline;
  padding: 14px 16px;
  background: var(--background-secondary);
  border-radius: 6px;
  font-size: var(--font-ui-small);
}
.pi-cron-meta-key {
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: var(--font-ui-smaller);
  letter-spacing: 0.06em;
  font-weight: 600;
}
.pi-cron-meta-val {
  color: var(--text-normal);
  font-family: var(--font-monospace);
  word-break: break-all;
}

/* Log section */
.pi-cron-log-section {
  display: flex; flex-direction: column; gap: 8px;
}
.pi-cron-log-label {
  font-size: var(--font-ui-smaller);
  text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--text-muted);
}
.pi-cron-log {
  background: var(--background-secondary);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  padding: 14px;
  border-radius: 6px;
  white-space: pre-wrap; word-break: break-all;
  max-height: 360px; overflow-y: auto;
  color: var(--text-normal); margin: 0;
  line-height: 1.5;
}
`;

function injectStyles() {
  // Always replace — Obsidian doesn't unload the <style> on plugin reload,
  // so without this, CSS changes never take effect until full app restart.
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ───────────────────────── Helpers ─────────────────────────

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function shortSessionName(name) {
  if (!name) return "—";
  return name.replace(/^--|--$/g, "").split("-").pop() || name;
}

// ───────────────────────── Base ItemView ─────────────────────────

class BasePiView extends obsidian.ItemView {
  constructor(leaf, hub) {
    super(leaf);
    this.hub = hub;
    this.unsubs = [];
    this._sheetStatusTimer = null;
  }

  sub(type, cb) { this.unsubs.push(this.hub.on(type, cb)); }

  renderConnectionFooter(parent) {
    const footer = parent.createDiv({ cls: "pi-cockpit-footer" });
    const dot = footer.createSpan({ cls: "pi-cockpit-dot" });
    const txt = footer.createSpan({ text: "Connecting..." });
    if (this.hub.connected) { dot.addClass("connected"); txt.setText("Connected"); }
    this.sub("connected", () => { dot.addClass("connected"); txt.setText("Connected"); });
    this.sub("disconnected", () => { dot.removeClass("connected"); txt.setText("Reconnecting..."); });
    return footer;
  }

  setSheetStatus(text, kind = "neutral") {
    if (!this.sheetStatusEl) return;
    this.sheetStatusEl.removeClass("is-pending");
    this.sheetStatusEl.removeClass("is-success");
    this.sheetStatusEl.removeClass("is-error");
    if (text) {
      this.sheetStatusEl.setText(text);
      if (kind && kind !== "neutral") this.sheetStatusEl.addClass(`is-${kind}`);
    } else {
      this.sheetStatusEl.setText("");
    }
  }

  clearSheetStatus() {
    if (this._sheetStatusTimer) {
      clearTimeout(this._sheetStatusTimer);
      this._sheetStatusTimer = null;
    }
    this.setSheetStatus("");
  }

  waitForMessage(type, predicate = () => true, timeoutMs = 5000) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      const off = this.hub.on(type, (msg) => {
        try {
          if (!predicate(msg)) return;
          cleanup();
          resolve(msg);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        try { off(); } catch {}
      };
      cancel = cleanup;
      if (timeoutMs > 0) {
        timer = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${type}`));
        }, timeoutMs);
      }
    });
    return { promise, cancel };
  }

  async runUiAction({
    label,
    request,
    successType,
    successPredicate = () => true,
    button = null,
    pendingText,
    successText,
    errorText,
    timeoutMs = 5000,
    clearAfter = 1200,
    onSuccess = null,
    onFailure = null,
  }) {
    const previousDisabled = button ? button.disabled : null;
    if (button) button.disabled = true;
    this.setSheetStatus(pendingText || `${label}…`, "pending");
    const waiter = successType ? this.waitForMessage(successType, successPredicate, timeoutMs) : { promise: Promise.resolve(null), cancel: () => {} };
    try {
      await request?.();
      const result = await waiter.promise;
      this.setSheetStatus(successText || `${label} done`, "success");
      if (onSuccess) await onSuccess(result);
      if (clearAfter > 0) {
        if (this._sheetStatusTimer) clearTimeout(this._sheetStatusTimer);
        this._sheetStatusTimer = window.setTimeout(() => {
          this.clearSheetStatus();
        }, clearAfter);
      }
      return result;
    } catch (err) {
      waiter.cancel();
      this.setSheetStatus(errorText || `${label} failed`, "error");
      if (onFailure) await onFailure(err);
      if (clearAfter > 0) {
        if (this._sheetStatusTimer) clearTimeout(this._sheetStatusTimer);
        this._sheetStatusTimer = window.setTimeout(() => {
          this.clearSheetStatus();
        }, clearAfter);
      }
      throw err;
    } finally {
      if (button) button.disabled = previousDisabled;
    }
  }

  async onClose() {
    if (this._sheetStatusTimer) {
      clearTimeout(this._sheetStatusTimer);
      this._sheetStatusTimer = null;
    }
    for (const u of this.unsubs) try { u(); } catch {}
    this.unsubs = [];
  }
}

// ───────────────────────── Sessions View ─────────────────────────

class SessionsView extends BasePiView {
  getViewType() { return VIEW_SESSIONS; }
  getDisplayText() { return "PI Sessions"; }
  getIcon() { return "folder"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    header.createSpan({ cls: "pi-cockpit-title", text: "PI Sessions" });
    const headerRight = header.createDiv({ cls: "pi-cockpit-header-right" });
    this.countEl = headerRight.createSpan({ cls: "pi-cockpit-subtitle", text: "0" });
    const newBtn = headerRight.createEl("button", {
      cls: "pi-cockpit-header-btn",
      attr: { title: "New session" }
    });
    phosphorIcon(newBtn, "plus", 14);
    newBtn.addEventListener("click", () => this.openNewSessionModal());

    this.bodyEl = root.createDiv({ cls: "pi-cockpit-body" });
    this.renderConnectionFooter(root);

    // Track which projects are expanded (Set of session-dir names).
    // Default: the active project is auto-expanded; the rest collapsed.
    this.expanded = new Set();

    this.sessions = this.hub.state.sessions || [];
    this.currentSession = this.hub.state.currentSession || null;
    this.currentSessionFile = this.hub.state.currentSessionFile || null;
    if (this.currentSession) this.expanded.add(this.currentSession);
    this.render();

    this.sub("state-sync", (d) => {
      this.sessions = d.sessions || [];
      this.currentSession = d.currentSession;
      this.currentSessionFile = d.currentSessionFile || null;
      if (this.currentSession) this.expanded.add(this.currentSession);
      this.render();
    });
    this.sub("session-changed", (d) => {
      this.currentSession = d.session;
      this.currentSessionFile = d.file || null;
      this.sessions = d.sessions || this.sessions;
      if (this.currentSession) this.expanded.add(this.currentSession);
      this.render();
    });
    this.sub("sessions-updated", (d) => {
      this.sessions = d.sessions || [];
      this.render();
    });

    if (!this.hub.connected) this.hub.connect();
  }

  toggleExpanded(name) {
    if (this.expanded.has(name)) this.expanded.delete(name);
    else this.expanded.add(name);
    this.render();
  }

  render() {
    const totalFiles = this.sessions.reduce((n, s) => n + (s.sessionCount || 0), 0);
    this.countEl.setText(`${this.sessions.length} · ${totalFiles}`);
    this.bodyEl.empty();

    if (this.sessions.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "pi-cockpit-empty" });
      phosphorIcon(empty.createDiv({ cls: "pi-cockpit-empty-icon" }), "file-text", 28);
      empty.createDiv({ text: "No active PI sessions" });
      return;
    }

    for (const s of this.sessions) {
      const isExpanded = this.expanded.has(s.name);
      const isActive = s.name === this.currentSession;

      // ── Project row ──────────────────────────────
      const project = this.bodyEl.createDiv({ cls: "pi-cockpit-item pi-cockpit-project" });
      if (isActive) project.addClass("active");
      project.title = s.projectPath || s.name;

      // Chevron toggle (separate from main click area so we don't swallow it)
      const chevron = project.createSpan({
        cls: "pi-cockpit-chevron",
        text: isExpanded ? "▾" : "▸",
      });
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleExpanded(s.name);
      });

      phosphorIcon(project.createSpan({ cls: "pi-cockpit-item-icon" }), s.isWorktree ? "git-branch" : "folder", 16);

      const main = project.createDiv({ cls: "pi-cockpit-item-main" });
      main.createDiv({ cls: "pi-cockpit-item-title", text: s.shortName || s.name });
      main.createDiv({ cls: "pi-cockpit-item-sub", text: s.projectPath || "" });

      const meta = project.createDiv({ cls: "pi-cockpit-item-meta" });
      meta.createSpan({ cls: "pi-cockpit-chip", text: String(s.sessionCount || 0) });
      meta.createSpan({ cls: "pi-cockpit-time", text: timeAgo(s.lastActivity) });

      // Clicking the project row (anywhere except chevron) resumes its most-recent JSONL.
      project.addEventListener("click", () => {
        this.hub.send({ type: "switch-session", session: s.name });
      });

      // ── Child JSONL files ────────────────────────
      if (isExpanded && Array.isArray(s.files) && s.files.length > 0) {
        const childList = this.bodyEl.createDiv({ cls: "pi-cockpit-child-list" });
        for (const f of s.files) {
          const childActive = isActive && this.currentSessionFile === f.file;
          const child = childList.createDiv({ cls: "pi-cockpit-item pi-cockpit-child" });
          if (childActive) child.addClass("active");
          child.title = f.file;

          child.createSpan({ cls: "pi-cockpit-child-rail" });
          child.createSpan({ cls: "pi-cockpit-item-icon", text: "•" });

          const cmain = child.createDiv({ cls: "pi-cockpit-item-main" });
          cmain.createDiv({ cls: "pi-cockpit-item-title", text: f.title });

          const cmeta = child.createDiv({ cls: "pi-cockpit-item-meta" });
          if (f.model && f.model !== "unknown") {
            cmeta.createSpan({ cls: "pi-cockpit-chip", text: f.model });
          }
          cmeta.createSpan({ cls: "pi-cockpit-time", text: timeAgo(f.lastActivity) });

          child.addEventListener("click", (e) => {
            e.stopPropagation();
            this.hub.send({ type: "switch-session", session: s.name, file: f.file });
          });
        }
      }
    }
  }

  // Open a sheet to start a fresh session in a project.
  // Pick an existing tracked project, type a folder path, or browse via Obsidian's vault root.
  openNewSessionModal() {
    const sheet = this.contentEl.createDiv({ cls: "pi-cron-sheet" });
    const head  = sheet.createDiv({ cls: "pi-cron-sheet-head" });
    head.createSpan({ cls: "pi-cron-sheet-title", text: "New session" });
    const close = head.createEl("button", { cls: "pi-cron-sheet-close", text: "×" });
    const closeIt = () => sheet.remove();
    close.addEventListener("click", closeIt);

    const body = sheet.createDiv({ cls: "pi-cron-sheet-body" });

    // Field: folder (custom path)
    const folderField = body.createDiv({ cls: "pi-cron-field" });
    folderField.createEl("label", { text: "Working folder" });
    const folderInput = folderField.createEl("input", {
      attr: { type: "text", placeholder: "/Users/.../my-project" }
    });
    const seed = this.sessions[0]?.cwd || "/Users/risingtidesdev/dev/Thoth";
    folderInput.value = seed;

    // Known projects (clickable list)
    const known = this.sessions.filter(s => s.cwd).slice(0, 8);
    if (known.length) {
      const recentLabel = body.createDiv({ cls: "pi-cron-log-label", text: "Recent projects" });
      recentLabel.style.marginTop = "4px";
      const list = body.createDiv({ cls: "pi-cron-recent-list" });
      for (const s of known) {
        const row = list.createDiv({ cls: "pi-cron-recent-row" });
        phosphorIcon(row.createSpan({ cls: "pi-cron-recent-icon" }), s.isWorktree ? "git-branch" : "folder", 14);
        const main = row.createDiv({ cls: "pi-cron-recent-main" });
        main.createDiv({ cls: "pi-cron-recent-title", text: s.shortName || s.name });
        main.createDiv({ cls: "pi-cron-recent-sub", text: s.cwd });
        row.addEventListener("click", () => { folderInput.value = s.cwd; });
      }
    }

    // Worktree toggle (informational — backend resolves worktree from path automatically)
    const wtField = body.createDiv({ cls: "pi-cron-field pi-cron-row-field" });
    wtField.createEl("label", { text: "Use worktree" });
    const wtToggle = wtField.createEl("input", { attr: { type: "checkbox" } });
    const wtNote = wtField.createEl("span", { cls: "pi-cron-field-hint", text: "create a fresh git worktree for this run" });

    const foot = sheet.createDiv({ cls: "pi-cron-sheet-foot" });
    const cancel = foot.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", closeIt);
    foot.createDiv({ cls: "pi-cron-spacer" });
    const startBtn = foot.createEl("button", { cls: "pi-cron-primary", text: "Start session" });
    startBtn.addEventListener("click", () => {
      const folder = folderInput.value.trim();
      if (!folder) { folderInput.focus(); return; }
      // Match server.js: a "new-session" message picks the cwd from the named session record.
      // If user typed a path matching a known project, route through that name; else fall through
      // to a generic new-session that uses currentSession's cwd as a fallback.
      const match = this.sessions.find(s => s.cwd === folder);
      const msg = match
        ? { type: "new-session", session: match.name }
        : { type: "new-session", cwd: folder, useWorktree: wtToggle.checked };
      this.hub.send(msg);
      closeIt();
    });

    folderInput.focus();
    folderInput.select();
  }
}

// ───────────────────────── Skills View ─────────────────────────

class SkillsView extends BasePiView {
  getViewType() { return VIEW_SKILLS; }
  getDisplayText() { return "Skills"; }
  getIcon() { return "package"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    this.titleEl = header.createSpan({ cls: "pi-cockpit-title", text: "Skills" });
    this.countEl = header.createSpan({ cls: "pi-cockpit-subtitle", text: "0" });

    const tabs = root.createDiv({ cls: "pi-cockpit-tabs" });
    this.tabSkills = tabs.createDiv({ cls: "pi-cockpit-tab active", text: "Skills" });
    this.tabMcp    = tabs.createDiv({ cls: "pi-cockpit-tab", text: "MCP" });
    this.tabSkills.addEventListener("click", () => this.switchTab("skills"));
    this.tabMcp.addEventListener("click",    () => this.switchTab("mcp"));

    this.searchEl = root.createEl("input", {
      cls: "pi-cockpit-search",
      attr: { type: "text", placeholder: "Filter..." }
    });
    this.searchEl.addEventListener("input", () => this.render());

    this.bodyEl = root.createDiv({ cls: "pi-cockpit-body" });
    this.renderConnectionFooter(root);

    this.activeTab = "skills";
    this.skills = this.hub.state.skills || [];
    this.mcpServers = this.hub.state.mcpServers || [];
    this.render();

    this.sub("state-sync", (d) => {
      this.skills = d.skills || [];
      this.mcpServers = d.mcpServers || [];
      this.render();
    });
    this.sub("skills-updated", (d) => {
      this.skills = d.skills || [];
      this.mcpServers = d.mcpServers || [];
      this.render();
    });
    this.sub("skill-copied", (d) => new obsidian.Notice(`Copied: ${d.skill}`));
    this.sub("mcp-copied",   (d) => new obsidian.Notice(`Copied: ${d.server}`));

    if (!this.hub.connected) this.hub.connect();
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.tabSkills.toggleClass("active", tab === "skills");
    this.tabMcp.toggleClass("active",    tab === "mcp");
    this.searchEl.value = "";
    this.render();
  }

  render() {
    const items = this.activeTab === "skills" ? this.skills : this.mcpServers;
    const filter = (this.searchEl.value || "").toLowerCase();
    const filtered = items.filter(i =>
      i.name.toLowerCase().includes(filter) ||
      (i.description || "").toLowerCase().includes(filter)
    );

    this.titleEl.setText(this.activeTab === "skills" ? "Skills" : "MCP Servers");
    this.countEl.setText(String(items.length));

    this.bodyEl.empty();

    if (filtered.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "pi-cockpit-empty" });
      phosphorIcon(empty.createDiv({ cls: "pi-cockpit-empty-icon" }), filter ? "magnifying-glass" : "file-text", 28);
      empty.createDiv({
        text: filter ? "No matches" : `No ${this.activeTab === "skills" ? "skills" : "MCP servers"} found`
      });
      return;
    }

    for (const item of filtered) {
      const row = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
      row.title = "Click to copy reference";

      phosphorIcon(row.createSpan({ cls: "pi-cockpit-item-icon" }), this.activeTab === "skills" ? "package" : "plug", 16);

      const main = row.createDiv({ cls: "pi-cockpit-item-main" });
      const titleLine = main.createDiv({ cls: "pi-cockpit-item-title" });
      titleLine.createSpan({ text: item.name });
      if (item.source) {
        titleLine.createSpan({ cls: "pi-cockpit-chip", text: item.source });
        titleLine.lastChild.style.marginLeft = "6px";
      }
      const subText = this.activeTab === "skills"
        ? (item.description || "")
        : (item.command || "");
      if (subText) main.createDiv({ cls: "pi-cockpit-item-sub", text: subText });

      phosphorIcon(row.createSpan({ cls: "pi-cockpit-item-meta" }), "copy", 14);

      row.addEventListener("click", () => {
        if (this.activeTab === "skills") {
          this.hub.send({ type: "copy-skill", skill: item.name });
        } else {
          this.hub.send({ type: "copy-mcp", server: item.name });
        }
      });
    }
  }
}

// ───────────────────────── Model View ─────────────────────────

const MODEL_ICONS = {
  "deepseek": "brain", "anthropic": "sparkle", "openai": "robot",
  "google": "circle", "minimax": "circle", "mistral": "circle",
  "groq": "circle", "xai": "circle", "ollama": "circle",
};

const FALLBACK_MODELS = [
  { id: "deepseek/deepseek-v4-pro", provider: "deepseek", modelId: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
  { id: "deepseek/deepseek-v4-flash", provider: "deepseek", modelId: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: false },
];

const AGENT_ROSTER = [
  { name: "Sage", icon: "brain", model: "opus", specialty: "Strategic architecture, system design, trade-off analysis" },
  { name: "Flux", icon: "sparkle", model: "sonnet", specialty: "Rapid implementation, debugging, production code" },
  { name: "Knox", icon: "warning-circle", model: "opus", specialty: "Security audits, testing, code quality, risk assessment" },
  { name: "Scout", icon: "magnifying-glass", model: "sonnet", specialty: "Technology research, options analysis, best practices" },
  { name: "SDK", icon: "code", model: "sonnet", specialty: "SDKs, libraries, code examples, integration patterns" },
  { name: "Pixel", icon: "package", model: "sonnet", specialty: "UI components, design systems, responsive layouts" },
  { name: "Aura", icon: "heart-pulse", model: "sonnet", specialty: "UX flows, interaction patterns, accessibility" },
  { name: "Ani", icon: "play", model: "sonnet", specialty: "Animation engineering, motion systems, 3D" },
  { name: "Brick", icon: "cube", model: "sonnet", specialty: "Backend APIs, data modeling, server-side logic" },
  { name: "Echo", icon: "terminal", model: "haiku", specialty: "Deployment, CI/CD, environments, infrastructure" },
  { name: "Kai", icon: "git-branch", model: "haiku", specialty: "Context optimization, workflow coordination, handoffs" },
  { name: "Taskmaster", icon: "list", model: "sonnet", specialty: "Project planning, PRD parsing, task breakdown" },
];

class ModelView extends BasePiView {
  getViewType() { return VIEW_MODEL; }
  getDisplayText() { return "Model"; }
  getIcon() { return "sliders"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    this.titleEl = header.createSpan({ cls: "pi-cockpit-title", text: "Model" });
    this.currentEl = header.createSpan({ cls: "pi-cockpit-subtitle", text: "" });

    const tabs = root.createDiv({ cls: "pi-cockpit-tabs" });
    this.tabModels = tabs.createDiv({ cls: "pi-cockpit-tab active", text: "Models" });
    this.tabAgents = tabs.createDiv({ cls: "pi-cockpit-tab", text: "Agents" });
    this.tabModels.addEventListener("click", () => this.switchTab("models"));
    this.tabAgents.addEventListener("click", () => this.switchTab("agents"));

    this.thinkingHeaderEl = root.createDiv({ cls: "pi-cockpit-section-header", text: "Thinking Level" });
    this.thinkingEl = root.createDiv({ cls: "pi-cockpit-thinking" });
    this.thinkingOpts = {};
    for (const lvl of ["off", "low", "high", "xhigh"]) {
      const opt = this.thinkingEl.createDiv({
        cls: "pi-cockpit-thinking-option",
        text: lvl === "xhigh" ? "X-High" : lvl[0].toUpperCase() + lvl.slice(1),
      });
      opt.addEventListener("click", () => this.setThinking(lvl));
      this.thinkingOpts[lvl] = opt;
    }

    this.bodyEl = root.createDiv({ cls: "pi-cockpit-body" });
    this.renderConnectionFooter(root);

    this.activeTab = "models";
    this.models = (this.hub.state.models && this.hub.state.models.length)
      ? this.hub.state.models : FALLBACK_MODELS;
    this.currentModel = this.hub.state.currentModel || "deepseek/deepseek-v4-pro";
    this.currentThinking = this.hub.state.currentThinkingLevel || "high";
    this.render();

    this.sub("state-sync", (d) => {
      if (d.models && d.models.length) this.models = d.models;
      this.currentModel = d.currentModel || this.currentModel;
      this.currentThinking = d.currentThinkingLevel || this.currentThinking;
      this.render();
    });
    this.sub("model-changed", (d) => {
      this.currentModel = d.model || this.currentModel;
      this.currentThinking = d.thinkingLevel || this.currentThinking;
      this.render();
    });

    if (!this.hub.connected) this.hub.connect();
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.render();
  }

  setThinking(level) {
    this.hub.send({ type: "switch-model", model: this.currentModel, thinkingLevel: level });
  }

  switchModel(id) {
    this.hub.send({ type: "switch-model", model: id });
  }

  renderModelRows() {
    for (const m of this.models) {
      const item = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
      if (m.id === this.currentModel) item.addClass("active");

      const iconName = MODEL_ICONS[m.provider] || "robot";
      phosphorIcon(item.createSpan({ cls: "pi-cockpit-item-icon" }), iconName, 16);
      const main = item.createDiv({ cls: "pi-cockpit-item-main" });
      main.createDiv({ cls: "pi-cockpit-item-title", text: m.name || m.modelId });
      main.createDiv({ cls: "pi-cockpit-item-sub", text: m.provider + (m.reasoning ? " · reasoning" : "") });

      item.addEventListener("click", () => this.switchModel(m.id));
    }
  }

  renderAgentRows() {
    for (const agent of AGENT_ROSTER) {
      const item = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
      phosphorIcon(item.createSpan({ cls: "pi-cockpit-item-icon" }), agent.icon, 16);

      const main = item.createDiv({ cls: "pi-cockpit-item-main" });
      const titleLine = main.createDiv({ cls: "pi-cockpit-item-title" });
      titleLine.createSpan({ text: agent.name });
      titleLine.createSpan({ cls: "pi-cockpit-chip pi-cockpit-chip-inset", text: agent.model });
      titleLine.lastChild.style.marginLeft = "6px";
      main.createDiv({ cls: "pi-cockpit-item-sub", text: agent.specialty });
    }
  }

  render() {
    const curModel = this.models.find(m => m.id === this.currentModel);
    const curName = curModel ? curModel.name : this.currentModel;

    const showingModels = this.activeTab === "models";
    this.titleEl.setText(showingModels ? "Model" : "Agents");
    this.currentEl.setText(showingModels
      ? `${curName} · ${this.currentThinking}`
      : `${AGENT_ROSTER.length} available`);

    this.tabModels.toggleClass("active", showingModels);
    this.tabAgents.toggleClass("active", !showingModels);
    this.thinkingHeaderEl.style.display = showingModels ? "" : "none";
    this.thinkingEl.style.display = showingModels ? "flex" : "none";

    this.bodyEl.empty();
    if (showingModels) {
      this.renderModelRows();
    } else {
      this.renderAgentRows();
    }

    for (const [lvl, el] of Object.entries(this.thinkingOpts)) {
      el.toggleClass("active", lvl === this.currentThinking);
    }
  }
}

// ───────────────────────── Cron Dashboard View (native) ─────────────────────────

const SCHEDULE_PRESETS = [
  { id: "manual",         label: "Manual" },
  { id: "hourly",         label: "Hourly" },
  { id: "every@15",       label: "Every 15 min" },
  { id: "every@30",       label: "Every 30 min" },
  { id: "daily@09:00",    label: "Daily 9:00" },
  { id: "daily@17:00",    label: "Daily 17:00" },
  { id: "weekdays@09:00", label: "Weekdays 9:00" },
];

class CronView extends BasePiView {
  getViewType() { return VIEW_CRON; }
  getDisplayText() { return "Crons"; }
  getIcon() { return "heart-pulse"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");
    root.style.position = "relative";

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    this.titleEl = header.createSpan({ cls: "pi-cockpit-title", text: "Daemons" });
    this.countEl = header.createSpan({ cls: "pi-cockpit-subtitle", text: "0" });

    const tabs = root.createDiv({ cls: "pi-cockpit-tabs" });
    this.tabDaemons  = tabs.createDiv({ cls: "pi-cockpit-tab active", text: "Daemons" });
    this.tabRoutines = tabs.createDiv({ cls: "pi-cockpit-tab", text: "Routines" });
    this.tabDaemons.addEventListener("click",  () => this.switchTab("daemons"));
    this.tabRoutines.addEventListener("click", () => this.switchTab("routines"));

    this.searchEl = root.createEl("input", {
      cls: "pi-cockpit-search",
      attr: { type: "text", placeholder: "Filter..." }
    });
    this.searchEl.addEventListener("input", () => this.render());

    this.bodyEl = root.createDiv({ cls: "pi-cockpit-body pi-cron-list" });
    this.renderConnectionFooter(root);

    this.activeTab = "daemons";
    this.daemons = [];
    this.heartbeat = null;
    this.routines = [];

    this.render();

    if (this.hub.connected) {
      this.hub.send({ type: "refresh-daemons" });
      this.hub.send({ type: "refresh-routines" });
    }
    this.sub("connected", () => {
      this.hub.send({ type: "refresh-daemons" });
      this.hub.send({ type: "refresh-routines" });
    });
    this.sub("daemons-updated", (d) => {
      if (Array.isArray(d.daemons)) this.daemons = d.daemons;
      if (d.heartbeat) this.heartbeat = d.heartbeat;
      this.render();
    });
    this.sub("routines-updated", (d) => {
      if (Array.isArray(d.routines)) this.routines = d.routines;
      this.render();
    });
    this.sub("daemon-restarted", (d) => new obsidian.Notice(d.success ? `Restarted ${d.label || ""}` : (d.message || "Restart failed")));
    this.sub("routine-saved",    () => new obsidian.Notice("Routine saved"));
    this.sub("routine-deleted",  () => new obsidian.Notice("Routine deleted"));
    this.sub("routine-ran",      (d) => new obsidian.Notice(d.ok ? "Triggered" : (d.message || "Run failed")));

    this.refreshTimer = window.setInterval(() => {
      if (this.hub.connected) {
        this.hub.send({ type: this.activeTab === "daemons" ? "refresh-daemons" : "refresh-routines" });
      }
    }, 30000);
  }

  async onClose() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await super.onClose();
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.tabDaemons.toggleClass("active",  tab === "daemons");
    this.tabRoutines.toggleClass("active", tab === "routines");
    this.searchEl.value = "";
    this.render();
  }

  render() {
    const items = this.activeTab === "daemons" ? this.daemons : this.routines;
    const filter = (this.searchEl.value || "").toLowerCase();
    const filtered = items.filter(i => {
      const hay = `${i.name || ""} ${i.description || ""} ${i.schedule || ""}`.toLowerCase();
      return hay.includes(filter);
    });

    this.titleEl.setText(this.activeTab === "daemons" ? "Daemons" : "Routines");
    this.countEl.setText(String(items.length));

    this.bodyEl.empty();

    // Routines tab: + New row at the top
    if (this.activeTab === "routines") {
      const newRow = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
      newRow.style.color = "var(--interactive-accent)";
      phosphorIcon(newRow.createSpan({ cls: "pi-cockpit-item-icon" }), "plus", 16);
      const main = newRow.createDiv({ cls: "pi-cockpit-item-main" });
      main.createDiv({ cls: "pi-cockpit-item-title", text: "New routine" });
      main.createDiv({ cls: "pi-cockpit-item-sub", text: "Create a scheduled task" });
      newRow.addEventListener("click", () => this.openRoutineEditor(null));
    }

    if (filtered.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "pi-cockpit-empty" });
      phosphorIcon(empty.createDiv({ cls: "pi-cockpit-empty-icon" }), filter ? "magnifying-glass" : "clock", 28);
      empty.createDiv({
        text: filter
          ? "No matches"
          : (this.activeTab === "daemons" ? "No daemons detected" : "No routines yet")
      });
      return;
    }

    if (this.activeTab === "daemons") {
      for (const d of filtered) this.renderDaemonRow(d);
    } else {
      for (const r of filtered) this.renderRoutineRow(r);
    }
  }

  renderDaemonRow(d) {
    const row = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
    row.title = d.label;

    phosphorIcon(row.createSpan({ cls: "pi-cockpit-item-icon" }), d.running ? "check-circle" : (d.loaded ? "circle" : "x-circle"), 16);

    const main = row.createDiv({ cls: "pi-cockpit-item-main" });
    main.createDiv({ cls: "pi-cockpit-item-title", text: d.name });
    const subBits = [];
    if (d.pid) subBits.push(`pid ${d.pid}`);
    subBits.push(timeAgo(d.lastLogEntry) || "no log");
    if (d.errorCount > 0) subBits.push(`${d.errorCount} err`);
    main.createDiv({ cls: "pi-cockpit-item-sub", text: subBits.join(" · ") });

    const meta = row.createDiv({ cls: "pi-cockpit-item-meta" });
    const state = d.running ? "running" : (d.loaded ? "loaded" : "down");
    meta.createSpan({ cls: "pi-cockpit-chip", text: state });

    row.addEventListener("click", () => this.openDaemonDetail(d));
  }

  renderRoutineRow(r) {
    const row = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
    row.title = r.slug;

    phosphorIcon(row.createSpan({ cls: "pi-cockpit-item-icon" }), "clock", 16);

    const main = row.createDiv({ cls: "pi-cockpit-item-main" });
    main.createDiv({ cls: "pi-cockpit-item-title", text: r.name });
    const subBits = [];
    subBits.push(r.schedule || "manual");
    if (r.description) subBits.push(r.description);
    main.createDiv({ cls: "pi-cockpit-item-sub", text: subBits.join(" · ") });

    const meta = row.createDiv({ cls: "pi-cockpit-item-meta" });
    meta.createSpan({ cls: "pi-cockpit-chip", text: r.enabled ? "active" : "paused" });

    row.addEventListener("click", () => this.openRoutineDetail(r));
  }

  // ── Inline modal (daemon detail) ──
  openDaemonDetail(d) {
    this.openSheet(d.name, (body, foot) => {
      const meta = body.createDiv({ cls: "pi-cron-meta" });
      const addRow = (k, v) => {
        meta.createDiv({ cls: "pi-cron-meta-key", text: k });
        meta.createDiv({ cls: "pi-cron-meta-val", text: v });
      };
      addRow("Label",  d.label);
      addRow("Status", d.running ? "running" : (d.loaded ? "loaded (not running)" : "not loaded"));
      if (d.pid)            addRow("PID",      String(d.pid));
      if (d.lastLogEntry)   addRow("Last log", `${timeAgo(d.lastLogEntry)} ago`);
      if (d.errorCount)     addRow("Errors",   `${d.errorCount} in stderr`);

      const logSection = body.createDiv({ cls: "pi-cron-log-section" });
      logSection.createDiv({ cls: "pi-cron-log-label", text: "Recent log" });
      const logBox = logSection.createEl("pre", { cls: "pi-cron-log" });
      logBox.textContent = "Loading log…";

      this.hub.send({ type: "view-daemon-log", label: d.label, lines: 60 });
      const off = this.hub.on("daemon-log", (msg) => {
        if (msg.label === d.label) logBox.textContent = msg.content || msg.message || "(empty)";
      });
      this.sheetCleanup = off;

      foot.createDiv({ cls: "pi-cron-spacer" });
      const restart = foot.createEl("button", { cls: "pi-cron-primary", text: "Restart" });
      restart.addEventListener("click", () => {
        if (!confirm(`Restart ${d.name}?`)) return;
        this.hub.send({ type: "restart-daemon", label: d.label });
      });
    });
  }

  // ── Inline modal (routine detail/edit) ──
  openRoutineDetail(r) {
    this.openSheet(r.name, (body, foot) => {
      // Hydrate full routine (prompt body)
      const off = this.hub.on("routine-detail", (msg) => {
        if (msg.slug !== r.slug) return;
        if (msg.routine) Object.assign(r, msg.routine);
        promptInput.value = (r.prompt || "").replace(/^---[\s\S]*?---\s*\n?/, "");
        try { off(); } catch {}
      });
      this.sheetCleanup = off;
      this.hub.send({ type: "get-routine", slug: r.slug });

      const nameField = body.createDiv({ cls: "pi-cron-field" });
      nameField.createEl("label", { text: "Name" });
      const nameInput = nameField.createEl("input", { attr: { type: "text", value: r.name } });
      nameInput.disabled = true;

      const descField = body.createDiv({ cls: "pi-cron-field" });
      descField.createEl("label", { text: "Description" });
      const descInput = descField.createEl("input", { attr: { type: "text", value: r.description || "" } });

      const schedField = body.createDiv({ cls: "pi-cron-field" });
      schedField.createEl("label", { text: "Schedule" });
      const schedSelect = schedField.createEl("select");
      for (const p of SCHEDULE_PRESETS) {
        const opt = schedSelect.createEl("option", { text: p.label, attr: { value: p.id } });
        if ((r.schedule || "manual") === p.id) opt.selected = true;
      }

      const folderField = body.createDiv({ cls: "pi-cron-field" });
      folderField.createEl("label", { text: "Folder" });
      const folderInput = folderField.createEl("input", { attr: { type: "text", value: r.folder || "" } });

      const promptField = body.createDiv({ cls: "pi-cron-field" });
      promptField.createEl("label", { text: "Prompt" });
      const promptInput = promptField.createEl("textarea");
      promptInput.value = (r.prompt || "").replace(/^---[\s\S]*?---\s*\n?/, "");

      const delBtn = foot.createEl("button", { cls: "pi-cron-danger", text: "Delete" });
      delBtn.addEventListener("click", () => {
        if (!confirm(`Delete routine "${r.name}"?`)) return;
        this.hub.send({ type: "delete-routine", slug: r.slug });
        this.closeSheet();
      });

      foot.createDiv({ cls: "pi-cron-spacer" });

      const pauseBtn = foot.createEl("button", { text: r.enabled ? "Pause" : "Resume" });
      pauseBtn.addEventListener("click", () => this.hub.send({ type: "toggle-routine", slug: r.slug, enabled: !r.enabled }));

      const runBtn = foot.createEl("button", { text: "Run now" });
      runBtn.addEventListener("click", () => this.hub.send({ type: "run-routine", slug: r.slug }));

      const saveBtn = foot.createEl("button", { cls: "pi-cron-primary", text: "Save" });
      saveBtn.addEventListener("click", () => {
        this.hub.send({
          type: "save-routine",
          routine: {
            name: r.name,
            description: descInput.value.trim(),
            schedule: schedSelect.value,
            folder: folderInput.value.trim(),
            prompt: promptInput.value,
            enabled: r.enabled,
          }
        });
        this.closeSheet();
      });
    });
  }

  openRoutineEditor(_unused) {
    this.openSheet("New routine", (body, foot) => {
      const nameField = body.createDiv({ cls: "pi-cron-field" });
      nameField.createEl("label", { text: "Name" });
      const nameInput = nameField.createEl("input", { attr: { type: "text", placeholder: "morning-standup" } });

      const descField = body.createDiv({ cls: "pi-cron-field" });
      descField.createEl("label", { text: "Description" });
      const descInput = descField.createEl("input", { attr: { type: "text", placeholder: "Short summary" } });

      const schedField = body.createDiv({ cls: "pi-cron-field" });
      schedField.createEl("label", { text: "Schedule" });
      const schedSelect = schedField.createEl("select");
      for (const p of SCHEDULE_PRESETS) {
        schedSelect.createEl("option", { text: p.label, attr: { value: p.id } });
      }

      const folderField = body.createDiv({ cls: "pi-cron-field" });
      folderField.createEl("label", { text: "Folder" });
      const folderInput = folderField.createEl("input", { attr: { type: "text", value: "/Users/risingtidesdev/dev/Thoth" } });

      const promptField = body.createDiv({ cls: "pi-cron-field" });
      promptField.createEl("label", { text: "Prompt" });
      const promptInput = promptField.createEl("textarea");
      promptInput.placeholder = "What should the agent do when this fires?";

      const cancel = foot.createEl("button", { text: "Cancel" });
      cancel.addEventListener("click", () => this.closeSheet());

      foot.createDiv({ cls: "pi-cron-spacer" });

      const create = foot.createEl("button", { cls: "pi-cron-primary", text: "Create" });
      create.addEventListener("click", () => {
        if (!nameInput.value.trim()) { nameInput.focus(); return; }
        if (!folderInput.value.trim()) { folderInput.focus(); return; }
        this.hub.send({
          type: "save-routine",
          routine: {
            name: nameInput.value.trim(),
            description: descInput.value.trim(),
            schedule: schedSelect.value,
            folder: folderInput.value.trim(),
            prompt: promptInput.value,
            enabled: true,
          }
        });
        this.closeSheet();
      });

      nameInput.focus();
    });
  }

  // ── Reusable bottom sheet ──
  openSheet(title, buildBody) {
    this.closeSheet();
    const sheet = this.contentEl.createDiv({ cls: "pi-cron-sheet" });
    const head = sheet.createDiv({ cls: "pi-cron-sheet-head" });
    head.createSpan({ cls: "pi-cron-sheet-title", text: title });
    const close = head.createEl("button", { cls: "pi-cron-sheet-close", text: "×" });
    close.addEventListener("click", () => this.closeSheet());

    const body = sheet.createDiv({ cls: "pi-cron-sheet-body" });
    const foot = sheet.createDiv({ cls: "pi-cron-sheet-foot" });
    this.sheetStatusEl = foot.createSpan({ cls: "pi-action-status", text: "" });

    this.activeSheet = sheet;
    buildBody(body, foot);
  }

  closeSheet() {
    if (this._sheetStatusTimer) {
      clearTimeout(this._sheetStatusTimer);
      this._sheetStatusTimer = null;
    }
    this.sheetStatusEl = null;
    if (this.activeSheet) { this.activeSheet.remove(); this.activeSheet = null; }
    if (this.sheetCleanup) { try { this.sheetCleanup(); } catch {} this.sheetCleanup = null; }
  }
}


// ───────────────────────── Tickets View ─────────────────────────

class TicketsView extends BasePiView {
  getViewType() { return VIEW_TICKETS; }
  getDisplayText() { return "Tickets"; }
  getIcon() { return "list"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    header.createSpan({ cls: "pi-cockpit-title", text: "Tickets" });
    const headerRight = header.createDiv({ cls: "pi-cockpit-header-right" });
    this.countEl = headerRight.createSpan({ cls: "pi-cockpit-subtitle", text: "0" });
    const newBtn = headerRight.createEl("button", { cls: "pi-cockpit-header-btn", attr: { title: "New ticket" } });
    phosphorIcon(newBtn, "plus", 14);
    newBtn.addEventListener("click", () => this.openTicketEditor(null));

    const tabs = root.createDiv({ cls: "pi-cockpit-tabs" });
    this.tabList = tabs.createDiv({ cls: "pi-cockpit-tab active", text: "List" });
    this.tabBoard = tabs.createDiv({ cls: "pi-cockpit-tab", text: "Board" });
    this.tabList.addEventListener("click", () => this.switchView("list"));
    this.tabBoard.addEventListener("click", () => this.switchView("board"));

    const toolbar = root.createDiv({ cls: "pi-tickets-toolbar" });
    this.searchEl = toolbar.createEl("input", { cls: "pi-cockpit-search", attr: { type: "text", placeholder: "Search tickets…" } });
    this.searchEl.addEventListener("input", () => this.render());
    this.stateFilter = toolbar.createEl("select", { cls: "pi-tickets-select" });
    this.stateFilter.addEventListener("change", () => this.render());
    this.assigneeFilter = toolbar.createEl("select", { cls: "pi-tickets-select" });
    this.assigneeFilter.addEventListener("change", () => this.render());

    this.bodyEl = root.createDiv({ cls: "pi-cockpit-body pi-tickets-list" });
    this.renderConnectionFooter(root);

    this.tickets = [];
    this.meta = { states: [], labels: [], users: [], projects: [] };
    this.priorityLabels = { 0: "None", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
    this.activeView = "list";
    this.renderFilters();
    this.render();

    if (this.hub.connected) this.hub.send({ type: "tickets-refresh" });
    this.sub("connected", () => this.hub.send({ type: "tickets-refresh" }));
    this.sub("tickets-snapshot", (d) => {
      this.tickets = Array.isArray(d.tickets) ? d.tickets : [];
      if (d.meta) this.meta = d.meta;
      if (d.priorityLabels) this.priorityLabels = d.priorityLabels;
      this.renderFilters();
      this.render();
    });
    this.sub("ticket-saved", (d) => {
      new obsidian.Notice(d.ticket?.identifier ? `Saved ${d.ticket.identifier}` : "Ticket saved");
    });
    this.sub("ticket-deleted", (d) => {
      new obsidian.Notice(d.identifier ? `Deleted ${d.identifier}` : "Ticket deleted");
    });
    this.sub("error", (d) => {
      const msg = d.message || "PI Cockpit error";
      if (msg.startsWith("ticket-") || msg.startsWith("tickets-")) new obsidian.Notice(msg);
    });
  }

  async onClose() {
    this.closeSheet();
    await super.onClose();
  }

  switchView(view) {
    this.activeView = view;
    this.tabList.toggleClass("active", view === "list");
    this.tabBoard.toggleClass("active", view === "board");
    this.render();
  }

  renderFilters() {
    if (!this.stateFilter || !this.assigneeFilter) return;
    const currentState = this.stateFilter.value;
    const currentAssignee = this.assigneeFilter.value;

    this.stateFilter.empty();
    this.stateFilter.createEl("option", { text: "All status", attr: { value: "" } });
    for (const s of this.meta.states || []) {
      const opt = this.stateFilter.createEl("option", { text: s.name || s.id, attr: { value: s.id } });
      if (s.id === currentState) opt.selected = true;
    }

    this.assigneeFilter.empty();
    this.assigneeFilter.createEl("option", { text: "All assignees", attr: { value: "" } });
    this.assigneeFilter.createEl("option", { text: "Unassigned", attr: { value: "__unassigned" } });
    for (const u of this.meta.users || []) {
      const opt = this.assigneeFilter.createEl("option", { text: `${u.avatar || "👤"} ${u.name || u.id}`, attr: { value: u.id } });
      if (u.id === currentAssignee) opt.selected = true;
    }
  }

  visibleTickets() {
    const q = (this.searchEl?.value || "").trim().toLowerCase();
    const state = this.stateFilter?.value || "";
    const assignee = this.assigneeFilter?.value || "";
    return [...this.tickets]
      .filter(t => {
        const hay = `${t.identifier || ""} ${t.title || ""} ${(t.labels || []).join(" ")} ${t.description || ""}`.toLowerCase();
        if (q && !hay.includes(q)) return false;
        if (state && t.state !== state) return false;
        if (assignee === "__unassigned" && t.assignee) return false;
        if (assignee && assignee !== "__unassigned" && t.assignee !== assignee) return false;
        return true;
      })
      .sort((a, b) => (this.priorityRank(a.priority) - this.priorityRank(b.priority)) || (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  priorityRank(p) {
    if (p === 0 || p == null) return 999;
    return Number(p) || 999;
  }

  render() {
    if (!this.bodyEl) return;
    const list = this.visibleTickets();
    this.countEl?.setText(`${list.length}/${this.tickets.length}`);
    this.bodyEl.empty();
    this.bodyEl.toggleClass("pi-tickets-list", this.activeView === "list");
    this.bodyEl.toggleClass("pi-tickets-board", this.activeView === "board");

    if (list.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "pi-cockpit-empty" });
      phosphorIcon(empty.createDiv({ cls: "pi-cockpit-empty-icon" }), "file-text", 28);
      empty.createDiv({ text: this.tickets.length ? "No matching tickets" : "No tickets yet" });
      empty.createDiv({ cls: "pi-cockpit-subtitle", text: "Create one here or sync GitHub issues into the vault." });
      return;
    }

    if (this.activeView === "board") this.renderBoard(list);
    else this.renderList(list);
  }

  renderList(list) {
    const grouped = new Map();
    for (const t of list) {
      const key = t.state || "_";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(t);
    }
    const states = this.meta.states?.length ? this.meta.states : [{ id: "_", name: "Tickets" }];
    const seen = new Set();
    for (const st of states) {
      const items = grouped.get(st.id) || [];
      if (!items.length) continue;
      seen.add(st.id);
      this.bodyEl.createDiv({ cls: "pi-tickets-group-header", text: `${st.name || st.id} · ${items.length}` });
      for (const t of items) this.renderTicketRow(t);
    }
    for (const [key, items] of grouped) {
      if (seen.has(key)) continue;
      this.bodyEl.createDiv({ cls: "pi-tickets-group-header", text: `${key === "_" ? "No status" : key} · ${items.length}` });
      for (const t of items) this.renderTicketRow(t);
    }
  }

  renderBoard(list) {
    const states = this.meta.states?.length ? this.meta.states : [{ id: "todo", name: "Todo" }];
    for (const st of states) {
      const items = list.filter(t => t.state === st.id);
      const col = this.bodyEl.createDiv({ cls: "pi-tickets-column" });
      const head = col.createDiv({ cls: "pi-tickets-column-head" });
      head.createSpan({ text: st.name || st.id });
      head.createSpan({ text: String(items.length) });
      for (const t of items) this.renderTicketCard(col, t);
    }
  }

  renderTicketRow(t) {
    const row = this.bodyEl.createDiv({ cls: "pi-cockpit-item" });
    phosphorIcon(row.createSpan({ cls: "pi-cockpit-item-icon" }), this.iconForPriority(t.priority), 16);
    const main = row.createDiv({ cls: "pi-cockpit-item-main" });
    main.createDiv({ cls: "pi-cockpit-item-title", text: `${t.identifier || "—"} · ${t.title || "Untitled"}` });
    const bits = [];
    bits.push(this.stateName(t.state));
    bits.push(this.priorityName(t.priority));
    if (t.assignee) bits.push(this.userName(t.assignee));
    if (t.updated_at) bits.push(`updated ${timeAgo(t.updated_at)} ago`);
    main.createDiv({ cls: "pi-cockpit-item-sub", text: bits.filter(Boolean).join(" · ") });
    const meta = row.createDiv({ cls: "pi-cockpit-item-meta" });
    for (const label of (t.labels || []).slice(0, 3)) meta.createSpan({ cls: "pi-cockpit-chip", text: label });
    row.addEventListener("click", () => this.openTicketDetail(t));
  }

  renderTicketCard(parent, t) {
    const card = parent.createDiv({ cls: "pi-tickets-card" });
    card.createDiv({ cls: "pi-tickets-card-title", text: `${t.identifier || "—"} · ${t.title || "Untitled"}` });
    const meta = card.createDiv({ cls: "pi-tickets-card-meta" });
    meta.createSpan({ cls: "pi-cockpit-chip", text: this.priorityName(t.priority) });
    if (t.assignee) meta.createSpan({ cls: "pi-cockpit-chip", text: this.userName(t.assignee) });
    for (const label of (t.labels || []).slice(0, 2)) meta.createSpan({ cls: "pi-cockpit-chip", text: label });
    card.addEventListener("click", () => this.openTicketDetail(t));
  }

  iconForPriority(p) {
    const n = Number(p || 0);
    if (n === 1) return "warning-circle";
    if (n === 2) return "circle";
    return "file-text";
  }

  stateName(id) {
    return this.meta.states?.find(s => s.id === id)?.name || id || "No status";
  }

  userName(id) {
    const u = this.meta.users?.find(u => u.id === id);
    return u ? `${u.avatar || "👤"} ${u.name || id}` : id;
  }

  priorityName(p) {
    return this.priorityLabels?.[p ?? 0] || "None";
  }

  cleanDescription(text, title) {
    let out = text || "";
    if (title) out = out.replace(new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\n?`, "i"), "");
    return out.trim();
  }

  openTicketDetail(t) {
    this.openSheet(`${t.identifier || "Ticket"} · ${t.title || "Untitled"}`, (body, foot) => {
      const meta = body.createDiv({ cls: "pi-cron-meta" });
      const addRow = (k, v) => { meta.createDiv({ cls: "pi-cron-meta-key", text: k }); meta.createDiv({ cls: "pi-cron-meta-val", text: v || "—" }); };
      addRow("Status", this.stateName(t.state));
      addRow("Priority", this.priorityName(t.priority));
      addRow("Assignee", t.assignee ? this.userName(t.assignee) : "Unassigned");
      addRow("Labels", (t.labels || []).join(", "));
      addRow("File", t._file || "");

      const descSection = body.createDiv({ cls: "pi-cron-log-section" });
      descSection.createDiv({ cls: "pi-cron-log-label", text: "Description" });
      descSection.createDiv({ cls: "pi-ticket-desc", text: this.cleanDescription(t.description, t.title) || "No description." });

      const commentsSection = body.createDiv({ cls: "pi-cron-log-section" });
      commentsSection.createDiv({ cls: "pi-cron-log-label", text: "Comments" });
      const comments = commentsSection.createDiv({ cls: "pi-ticket-comment-list" });
      comments.createDiv({ cls: "pi-ticket-comment", text: "Loading comments…" });

      const commentField = body.createDiv({ cls: "pi-cron-field" });
      commentField.createEl("label", { text: "Add comment" });
      const commentInput = commentField.createEl("textarea");
      commentInput.placeholder = "Write a comment…";
      commentInput.style.minHeight = "80px";
      const commentBtn = body.createEl("button", { cls: "pi-cron-primary", text: "Add comment" });
      commentBtn.style.alignSelf = "flex-start";
      commentBtn.addEventListener("click", async () => {
        const bodyText = commentInput.value.trim();
        if (!bodyText) return;
        try {
          await this.runUiAction({
            label: "Post comment",
            button: commentBtn,
            pendingText: "Posting comment…",
            successText: "Comment posted",
            errorText: "Comment failed",
            successType: "ticket-comments",
            successPredicate: (msg) => msg.identifier === t.identifier,
            request: () => this.hub.send({ type: "ticket-comment-add", identifier: t.identifier, body: bodyText, author: "john" }),
          });
          commentInput.value = "";
        } catch {}
      });

      const renderComments = (items) => {
        comments.empty();
        if (!items.length) {
          comments.createDiv({ cls: "pi-ticket-comment", text: "No comments yet." });
          return;
        }
        for (const c of items) {
          const row = comments.createDiv({ cls: "pi-ticket-comment" });
          row.createDiv({ cls: "pi-ticket-comment-meta", text: `${c.author || "unknown"} · ${c.created_at ? timeAgo(c.created_at) + " ago" : ""}` });
          row.createDiv({ text: c.body || "" });
        }
      };

      const offDetail = this.hub.on("ticket-detail", (msg) => {
        if (msg.identifier !== t.identifier) return;
        renderComments(msg.comments || []);
      });
      const offComments = this.hub.on("ticket-comments", (msg) => {
        if (msg.identifier !== t.identifier) return;
        renderComments(msg.comments || []);
      });
      this.sheetCleanup = () => { try { offDetail(); } catch {}; try { offComments(); } catch {}; };
      this.hub.send({ type: "ticket-get", identifier: t.identifier });

      const delBtn = foot.createEl("button", { cls: "pi-cron-danger", text: "Delete" });
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Delete ${t.identifier}?`)) return;
        try {
          await this.runUiAction({
            label: `Delete ${t.identifier}`,
            button: delBtn,
            pendingText: `Deleting ${t.identifier}…`,
            successText: `${t.identifier} deleted`,
            errorText: `Delete failed`,
            successType: "ticket-deleted",
            successPredicate: (msg) => msg.identifier === t.identifier,
            request: () => this.hub.send({ type: "ticket-delete", identifier: t.identifier }),
            onSuccess: () => this.closeSheet(),
          });
        } catch {}
      });
      foot.createDiv({ cls: "pi-cron-spacer" });
      const editBtn = foot.createEl("button", { text: "Edit" });
      editBtn.addEventListener("click", () => this.openTicketEditor(t));
      const stateSelect = foot.createEl("select", { cls: "pi-tickets-select" });
      for (const st of this.meta.states || []) {
        const opt = stateSelect.createEl("option", { text: st.name || st.id, attr: { value: st.id } });
        if (st.id === t.state) opt.selected = true;
      }
      stateSelect.addEventListener("change", async () => {
        try {
          await this.runUiAction({
            label: `Move ${t.identifier}`,
            button: stateSelect,
            pendingText: `Moving ${t.identifier}…`,
            successText: `Status updated`,
            errorText: `Status update failed`,
            successType: "ticket-saved",
            successPredicate: (msg) => msg.ticket?.identifier === t.identifier,
            request: () => this.hub.send({ type: "ticket-transition", identifier: t.identifier, state: stateSelect.value, actor: "john" }),
          });
        } catch {}
      });
    });
  }

  openTicketEditor(t) {
    const isNew = !t;
    const data = t || { title: "", description: "", state: "todo", priority: 0, labels: [] };
    this.openSheet(isNew ? "New ticket" : `Edit ${data.identifier}`, (body, foot) => {
      const titleField = body.createDiv({ cls: "pi-cron-field" });
      titleField.createEl("label", { text: "Title" });
      const titleInput = titleField.createEl("input", { attr: { type: "text", value: data.title || "" } });

      const descField = body.createDiv({ cls: "pi-cron-field" });
      descField.createEl("label", { text: "Description" });
      const descInput = descField.createEl("textarea");
      descInput.value = this.cleanDescription(data.description, data.title);

      const stateField = body.createDiv({ cls: "pi-cron-field" });
      stateField.createEl("label", { text: "Status" });
      const stateSelect = stateField.createEl("select");
      for (const st of this.meta.states || []) {
        const opt = stateSelect.createEl("option", { text: st.name || st.id, attr: { value: st.id } });
        if ((data.state || "todo") === st.id) opt.selected = true;
      }

      const priorityField = body.createDiv({ cls: "pi-cron-field" });
      priorityField.createEl("label", { text: "Priority" });
      const prioritySelect = priorityField.createEl("select");
      for (const p of [0, 1, 2, 3, 4]) {
        const opt = prioritySelect.createEl("option", { text: `${p} · ${this.priorityName(p)}`, attr: { value: String(p) } });
        if (Number(data.priority || 0) === p) opt.selected = true;
      }

      const assigneeField = body.createDiv({ cls: "pi-cron-field" });
      assigneeField.createEl("label", { text: "Assignee" });
      const assigneeSelect = assigneeField.createEl("select");
      assigneeSelect.createEl("option", { text: "Unassigned", attr: { value: "" } });
      for (const u of this.meta.users || []) {
        const opt = assigneeSelect.createEl("option", { text: `${u.avatar || "👤"} ${u.name || u.id}`, attr: { value: u.id } });
        if (data.assignee === u.id) opt.selected = true;
      }

      const labelsField = body.createDiv({ cls: "pi-cron-field" });
      labelsField.createEl("label", { text: "Labels" });
      const labelsInput = labelsField.createEl("input", { attr: { type: "text", value: (data.labels || []).join(", "), placeholder: "bug, infra" } });

      const estimateField = body.createDiv({ cls: "pi-cron-field" });
      estimateField.createEl("label", { text: "Estimate" });
      const estimateInput = estimateField.createEl("input", { attr: { type: "number", min: "0", value: data.estimate ?? "" } });

      const cancelBtn = foot.createEl("button", { text: "Cancel" });
      cancelBtn.addEventListener("click", () => this.closeSheet());
      foot.createDiv({ cls: "pi-cron-spacer" });
      const saveBtn = foot.createEl("button", { cls: "pi-cron-primary", text: "Save" });
      saveBtn.addEventListener("click", async () => {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        const ticket = {
          ...data,
          title,
          description: descInput.value.trim(),
          state: stateSelect.value || "todo",
          priority: Number(prioritySelect.value || 0),
          assignee: assigneeSelect.value || null,
          labels: labelsInput.value.split(",").map(s => s.trim()).filter(Boolean),
          estimate: estimateInput.value === "" ? null : Number(estimateInput.value),
        };
        try {
          await this.runUiAction({
            label: isNew ? "Create ticket" : `Save ${data.identifier}`,
            button: saveBtn,
            pendingText: isNew ? "Creating ticket…" : `Saving ${data.identifier}…`,
            successText: isNew ? "Ticket created" : `${data.identifier} saved`,
            errorText: isNew ? "Create failed" : "Save failed",
            successType: "ticket-saved",
            successPredicate: (msg) => msg.ticket?.identifier === (data.identifier || msg.ticket?.identifier),
            request: () => this.hub.send({ type: "ticket-save", ticket }),
            onSuccess: () => this.closeSheet(),
          });
        } catch {}
      });
      titleInput.focus();
    });
  }

  openSheet(title, buildBody) {
    this.closeSheet();
    const sheet = this.contentEl.createDiv({ cls: "pi-cron-sheet" });
    const head = sheet.createDiv({ cls: "pi-cron-sheet-head" });
    head.createSpan({ cls: "pi-cron-sheet-title", text: title });
    const close = head.createEl("button", { cls: "pi-cron-sheet-close", text: "×" });
    close.addEventListener("click", () => this.closeSheet());
    const body = sheet.createDiv({ cls: "pi-cron-sheet-body" });
    const foot = sheet.createDiv({ cls: "pi-cron-sheet-foot" });
    this.sheetStatusEl = foot.createSpan({ cls: "pi-action-status", text: "" });
    this.activeSheet = sheet;
    buildBody(body, foot);
  }

  closeSheet() {
    if (this._sheetStatusTimer) {
      clearTimeout(this._sheetStatusTimer);
      this._sheetStatusTimer = null;
    }
    this.sheetStatusEl = null;
    if (this.activeSheet) { this.activeSheet.remove(); this.activeSheet = null; }
    if (this.sheetCleanup) { try { this.sheetCleanup(); } catch {} this.sheetCleanup = null; }
  }
}

// ───────────────────────── Vault Chat View ─────────────────────────

class ChatView extends BasePiView {
  getViewType() { return VIEW_CHAT; }
  getDisplayText() { return "Vault Chat"; }
  getIcon() { return "message-square"; }

  async onOpen() {
    injectStyles();
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-cockpit-root");

    const header = root.createDiv({ cls: "pi-cockpit-header" });
    header.createSpan({ cls: "pi-cockpit-title", text: "Vault Chat" });
    const headerRight = header.createDiv({ cls: "pi-cockpit-header-right" });
    this.statusEl = headerRight.createSpan({ cls: "pi-cockpit-subtitle", text: "" });

    // Telegram connect/disconnect badge — toggles which session Telegram routes into.
    this.telegramBadge = headerRight.createEl("button", {
      cls: "pi-cockpit-telegram-badge",
      attr: { title: "Connect this session to Telegram" }
    });
    this.telegramBadge.createSpan({ cls: "pi-cockpit-dot" });
    this.telegramLabel = this.telegramBadge.createSpan({ text: "Telegram" });
    this.telegramBadge.addEventListener("click", () => {
      if (this.telegramSession && this.telegramSession === this.currentSession) {
        this.hub.send({ type: "telegram-disconnect" });
      } else {
        this.hub.send({ type: "telegram-connect", session: this.currentSession });
      }
    });

    const sessionBar = root.createDiv({ cls: "pi-cockpit-session-bar" });
    phosphorIcon(sessionBar.createSpan(), "folder", 14);
    this.sessionNameEl = sessionBar.createSpan({ cls: "pi-cockpit-session-name", text: "No session" });

    const launchRow = root.createDiv({ cls: "pi-cockpit-launch-row" });
    const launches = [
      { name: "Session", widget: "session-switcher", icon: "folder" },
      { name: "Skills",  widget: "skills-directory", icon: "package" },
      { name: "Model",   widget: "model-switcher",   icon: "sliders" },
      { name: "Crons",   widget: "cron-dashboard",   icon: "heart-pulse" },
      { name: "Tickets", widget: "tickets",          icon: "list" },
    ];
    for (const l of launches) {
      const btn = launchRow.createEl("button", { cls: "pi-cockpit-launch-btn" });
      phosphorIcon(btn.createSpan(), l.icon, 14);
      btn.createSpan({ text: l.name });
      btn.addEventListener("click", () => this.plugin.openWidget(l.widget));
    }

    this.messagesEl = root.createDiv({ cls: "pi-cockpit-chat-messages" });
    this.addMessage("system", "Ready. Type a message to talk to PI.");

    const inputRow = root.createDiv({ cls: "pi-cockpit-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "pi-cockpit-chat-input",
      attr: { placeholder: "Talk to your vault...", rows: "1" }
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    this.sendBtn = inputRow.createEl("button", { cls: "pi-cockpit-send-btn" });
    phosphorIcon(this.sendBtn, "paper-plane", 16);
    this.sendBtn.addEventListener("click", () => this.send());

    // Tokens / cost footer (shown when stats are available)
    this.statsBar = root.createDiv({ cls: "pi-cockpit-stats-bar" });
    this.statsBar.style.display = "none";
    this.statsBar.innerHTML = `
      <span class="pi-cockpit-stat"><span class="pi-cockpit-stat-label">ctx</span><span class="pi-cockpit-stat-val" data-stat="ctx">—</span></span>
      <span class="pi-cockpit-stat"><span class="pi-cockpit-stat-label">in</span><span class="pi-cockpit-stat-val" data-stat="in">—</span></span>
      <span class="pi-cockpit-stat"><span class="pi-cockpit-stat-label">out</span><span class="pi-cockpit-stat-val" data-stat="out">—</span></span>
      <span class="pi-cockpit-stat"><span class="pi-cockpit-stat-label">$</span><span class="pi-cockpit-stat-val" data-stat="cost">—</span></span>
    `;

    // Streaming state
    this.isStreaming = false;
    this.currentAssistantMsg = null;    // DOM element for current streaming message
    this.currentToolEls = new Map();    // toolCallId → DOM element

    this.currentSession  = this.hub.state.currentSession || null;
    this.currentModel    = this.hub.state.currentModel || "deepseek-v4-pro";
    this.currentThinking = this.hub.state.currentThinkingLevel || "high";
    this.telegramSession = this.hub.state.telegramSession || null;
    this.updateBadges();
    this.updateTelegramBadge();

    this.sub("state-sync", (d) => {
      const prevSession = this.currentSession;
      this.currentSession  = d.currentSession;
      this.currentModel    = d.currentModel || this.currentModel;
      this.currentThinking = d.currentThinkingLevel || this.currentThinking;
      this.telegramSession = d.telegramSession || null;
      if (d.isStreaming !== undefined) {
        this.isStreaming = d.isStreaming;
        this.sendBtn.disabled = d.isStreaming;
      }
      this.currentSessionFile = d.currentSessionFile || this.currentSessionFile || null;
      this.updateBadges();
      this.updateTelegramBadge();
      // Request fresh stats so the footer fills in on view open
      this.hub.send({ type: "get-session-stats" });
      // First-time open: if hub already has an active session, pull history.
      if (!this._historyLoaded && this.currentSession && this.currentSession !== prevSession) {
        this._historyLoaded = true;
        this._requestHistory(this.currentSession, this.currentSessionFile);
      }
    });
    this.sub("session-changed", (d) => {
      this.currentSession = d.session;
      this.currentSessionFile = d.file || null;
      this.updateBadges();
      this.updateTelegramBadge();
      // Reset chat surface + request prior history for the new session/file.
      this.messagesEl.empty();
      this.currentAssistantMsg = null;
      this.currentToolEls.clear();
      this.addMessage("system", `Switched to: ${shortSessionName(d.session)}`);
      this._requestHistory(d.session, d.file || null);
    });
    this.sub("session-history", (d) => {
      if (!d.entries) return;
      this._renderHistory(d.entries);
    });
    this.sub("model-changed", (d) => {
      this.currentModel    = d.model || this.currentModel;
      this.currentThinking = d.thinkingLevel || this.currentThinking;
      this.updateBadges();
    });
    this.sub("chat-status", (d) => {
      if (d.status === "received") this.statusEl.setText("Processing...");
      else if (d.status === "error") this.addMessage("system", `Error: ${d.message}`);
      else if (d.status === "starting") this.addMessage("system", d.message);
    });
    this.sub("agent-status", (d) => {
      this.isStreaming = d.streaming;
      this.sendBtn.disabled = d.streaming;
      if (d.streaming) {
        this.statusEl.setText("Streaming...");
      } else {
        this.statusEl.setText("");
        // Finalize current turn — strip caret, collapse activity strip.
        if (this.currentAssistantMsg) {
          this.currentAssistantMsg.removeClass("streaming");
          const textEl = this.currentAssistantMsg.querySelector(".pi-cockpit-turn-text");
          if (textEl && this.currentAssistantMsg._textBuffer) {
            this._renderMarkdownInto(textEl, this.currentAssistantMsg._textBuffer, false);
          } else if (textEl) {
            const caret = textEl.querySelector(".pi-cockpit-msg-streaming-caret");
            if (caret) caret.remove();
          }
          const activity = this.currentAssistantMsg.querySelector(".pi-cockpit-activity");
          if (activity) activity.classList.remove("open");
          this.currentAssistantMsg = null;
        }
      }
    });

    // Handle raw agent events forwarded from hub
    this.sub("agent-event", (d) => {
      if (!d.event) return;
      const evt = d.event;
      this._handleAgentEvent(evt);
    });

    // Handle user messages from other clients (e.g. Telegram)
    this.sub("user-message", (d) => {
      if (d.origin && d.message) {
        this.addMessage("user", d.message, d.origin);
      }
    });

    // Telegram bridge status
    this.sub("telegram-changed", (d) => {
      this.telegramSession = d.telegramSession || null;
      this.updateTelegramBadge();
    });

    // Session stats footer (tokens + cost) — broadcast by hub on every agent_end.
    this.sub("session-stats", (d) => this.updateStats(d.stats));

    if (!this.hub.connected) this.hub.connect();
  }

  _handleAgentEvent(evt) {
    switch (evt.type) {
      case "message_update":
        this._handleStreamDelta(evt.assistantMessageEvent);
        break;
      case "message_start":
        // New message starts — if it's assistant, we'll pick it up on first delta
        break;
      case "tool_execution_start":
        this._handleToolStart(evt);
        break;
      case "tool_execution_update":
        this._handleToolUpdate(evt);
        break;
      case "tool_execution_end":
        this._handleToolEnd(evt);
        break;
      case "turn_start":
        // New turn — make sure a container exists, ready for first delta.
        this._ensureAssistantTurn();
        break;
    }
  }

  _handleStreamDelta(delta) {
    if (!delta) return;

    if (delta.type === "text_delta") {
      const turn = this._ensureAssistantTurn();
      turn._textBuffer = (turn._textBuffer || "") + delta.delta;
      const textEl = turn.querySelector(".pi-cockpit-turn-text");
      if (textEl) this._renderMarkdownInto(textEl, turn._textBuffer, /*withCaret*/ true);
      this._scrollBottom();
    }

    if (delta.type === "thinking_delta") {
      const turn = this._ensureAssistantTurn();
      const activity = this._ensureActivity(turn);
      const thinkEl = this._ensureThinkingBlock(activity.body);
      turn._thinkBuffer = (turn._thinkBuffer || "") + delta.delta;
      thinkEl.setText(turn._thinkBuffer);
      this._updateActivitySummary(turn);
      this._scrollBottom();
    }
  }

  _handleToolStart(evt) {
    const turn = this._ensureAssistantTurn();
    const activity = this._ensureActivity(turn);

    const toolEl = activity.body.createDiv({ cls: "pi-cockpit-tool" });
    const header = toolEl.createDiv({ cls: "pi-cockpit-tool-header" });
    header.createSpan({ cls: "pi-cockpit-tool-name", text: evt.toolName });
    const summary = this._toolSummary(evt.args);
    if (summary) header.createSpan({ cls: "pi-cockpit-role-meta", text: summary });
    header.createSpan({ cls: "pi-cockpit-tool-status running", text: "running" });

    const output = toolEl.createDiv({ cls: "pi-cockpit-tool-output" });
    const argsText = evt.args && Object.keys(evt.args).length
      ? JSON.stringify(evt.args, null, 2)
      : "";
    output.setText(argsText);

    header.addEventListener("click", () => output.classList.toggle("open"));

    this.currentToolEls.set(evt.toolCallId, { toolEl, header, output });
    this._updateActivitySummary(turn);
    this._scrollBottom();
  }

  _handleToolUpdate(evt) {
    const entry = this.currentToolEls.get(evt.toolCallId);
    if (!entry) return;
    if (evt.partialResult?.content?.[0]?.text) {
      entry.output.setText(evt.partialResult.content[0].text);
    }
    this._scrollBottom();
  }

  _handleToolEnd(evt) {
    const entry = this.currentToolEls.get(evt.toolCallId);
    if (!entry) return;
    const statusEl = entry.header.querySelector(".pi-cockpit-tool-status");
    if (statusEl) {
      statusEl.removeClass("running");
      statusEl.addClass(evt.isError ? "error" : "done");
      statusEl.setText(evt.isError ? "error" : "done");
    }
    if (evt.result?.content?.[0]?.text) {
      const text = evt.result.content[0].text;
      entry.output.setText(text.length > 800 ? text.slice(0, 800) + "\n…" : text);
    }
    if (this.currentAssistantMsg) this._updateActivitySummary(this.currentAssistantMsg);
    this._scrollBottom();
  }

  // ── Turn / activity DOM helpers ─────────────────────────

  _ensureAssistantTurn() {
    if (this.currentAssistantMsg && this.currentAssistantMsg.isConnected) {
      return this.currentAssistantMsg;
    }
    const turn = this._createTurn("assistant", { streaming: true });
    this.currentAssistantMsg = turn;
    return turn;
  }

  _createTurn(role, opts = {}) {
    const turn = this.messagesEl.createDiv({ cls: `pi-cockpit-turn ${role}` });
    if (opts.streaming) turn.addClass("streaming");
    turn.createDiv({ cls: "pi-cockpit-turn-rail" });
    const body = turn.createDiv({ cls: "pi-cockpit-turn-body" });

    const roleRow = body.createDiv({ cls: "pi-cockpit-turn-role" });
    roleRow.createSpan({
      cls: "pi-cockpit-role-name",
      text: role === "user" ? "You" : "PI",
    });
    if (opts.meta) {
      roleRow.createSpan({ cls: "pi-cockpit-role-meta", text: opts.meta });
    }

    // Activity goes between role and text (only used for assistant).
    body.createDiv({ cls: "pi-cockpit-turn-activity-slot" });
    body.createDiv({ cls: "pi-cockpit-turn-text" });
    return turn;
  }

  _ensureActivity(turn) {
    const slot = turn.querySelector(".pi-cockpit-turn-activity-slot");
    let activity = slot.querySelector(".pi-cockpit-activity");
    if (activity) {
      return { wrap: activity, body: activity.querySelector(".pi-cockpit-activity-body") };
    }
    activity = slot.createDiv({ cls: "pi-cockpit-activity open" });
    const header = activity.createDiv({ cls: "pi-cockpit-activity-header" });
    phosphorIcon(header.createSpan(), "brain", 11);
    header.createSpan({ text: "Activity" });
    header.createSpan({ cls: "pi-cockpit-activity-summary", text: "" });
    header.createSpan({ cls: "pi-cockpit-activity-caret", text: "▸" });
    const body = activity.createDiv({ cls: "pi-cockpit-activity-body" });
    header.addEventListener("click", () => activity.classList.toggle("open"));
    return { wrap: activity, body };
  }

  _ensureThinkingBlock(body) {
    let block = body.querySelector(".pi-cockpit-thinking-block");
    if (!block) {
      // Thinking always above tool calls — insert at top of activity body.
      block = body.createDiv({ cls: "pi-cockpit-thinking-block" });
      body.insertBefore(block, body.firstChild?.nextSibling || null);
    }
    return block;
  }

  _toolSummary(args) {
    if (!args || typeof args !== "object") return "";
    // Prefer the most descriptive single field.
    for (const k of ["path", "file", "pattern", "command", "cmd", "query", "url"]) {
      if (typeof args[k] === "string") return args[k].length > 60 ? args[k].slice(0, 60) + "…" : args[k];
    }
    return "";
  }

  _updateActivitySummary(turn) {
    const activity = turn.querySelector(".pi-cockpit-activity");
    if (!activity) return;
    const summaryEl = activity.querySelector(".pi-cockpit-activity-summary");
    if (!summaryEl) return;
    const hasThinking = !!activity.querySelector(".pi-cockpit-thinking-block");
    const toolCount = activity.querySelectorAll(".pi-cockpit-tool").length;
    const parts = [];
    if (hasThinking) parts.push("thinking");
    if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
    summaryEl.setText(parts.length ? `· ${parts.join(" · ")}` : "");
  }

  _renderMarkdownInto(el, source, withCaret) {
    el.empty();
    try {
      obsidian.MarkdownRenderer.render(this.app, source || "", el, "", this);
    } catch (err) {
      el.setText(source || "");
    }
    if (withCaret) {
      el.createSpan({ cls: "pi-cockpit-msg-streaming-caret" });
    }
  }

  _scrollBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  updateBadges() {
    this.sessionNameEl.setText(shortSessionName(this.currentSession));
    this.statusEl.setText(`${this.currentModel} · ${this.currentThinking}`);
  }

  updateTelegramBadge() {
    if (!this.telegramBadge) return;
    const connectedHere = !!this.telegramSession && this.telegramSession === this.currentSession;
    const connectedElsewhere = !!this.telegramSession && this.telegramSession !== this.currentSession;
    this.telegramBadge.toggleClass("connected", connectedHere);
    if (connectedHere) {
      this.telegramLabel.setText("Telegram · live");
      this.telegramBadge.setAttribute("title", "Disconnect Telegram from this session");
    } else if (connectedElsewhere) {
      this.telegramLabel.setText(`Telegram · ${shortSessionName(this.telegramSession)}`);
      this.telegramBadge.setAttribute("title", `Telegram is routed to ${this.telegramSession}. Click to redirect to this session.`);
    } else {
      this.telegramLabel.setText("Telegram");
      this.telegramBadge.setAttribute("title", "Connect this session to Telegram");
    }
  }

  // Format token / cost stats coming from the PI SDK.
  // The SDK shape can vary by provider; we look up common keys defensively.
  updateStats(stats) {
    if (!this.statsBar) return;
    if (!stats) { this.statsBar.style.display = "none"; return; }
    const pick = (...keys) => {
      for (const k of keys) {
        const v = k.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), stats);
        if (typeof v === "number") return v;
      }
      return null;
    };
    const ctx  = pick("contextTokens", "context.total", "totalContextTokens", "context_tokens");
    const inT  = pick("inputTokens", "totalInputTokens", "input_tokens", "tokens.input");
    const outT = pick("outputTokens", "totalOutputTokens", "output_tokens", "tokens.output");
    const cost = pick("costUsd", "totalCostUsd", "cost", "totalCost");

    const fmt = (n) => {
      if (n == null) return "—";
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
      return String(n);
    };
    const fmtCost = (n) => (n == null ? "—" : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`);

    this.statsBar.querySelector('[data-stat="ctx"]').textContent  = fmt(ctx);
    this.statsBar.querySelector('[data-stat="in"]').textContent   = fmt(inT);
    this.statsBar.querySelector('[data-stat="out"]').textContent  = fmt(outT);
    this.statsBar.querySelector('[data-stat="cost"]').textContent = fmtCost(cost);

    // Only show the bar if we actually got at least one number
    const hasAny = [ctx, inT, outT, cost].some(v => v != null);
    this.statsBar.style.display = hasAny ? "" : "none";
  }

  // ── Public message API used by status events / send ─────

  addMessage(role, text, origin) {
    if (role === "system") {
      const el = this.messagesEl.createDiv({ cls: "pi-cockpit-turn-system" });
      el.setText(text);
      this._scrollBottom();
      return el;
    }
    const turn = this._createTurn(role);
    if (origin) {
      const badge = turn.createDiv({ cls: "pi-cockpit-origin-badge", text: origin });
    }
    const textEl = turn.querySelector(".pi-cockpit-turn-text");
    this._renderMarkdownInto(textEl, text, false);
    this._scrollBottom();
    return turn;
  }

  send() {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;

    if (text.startsWith("/model ")) {
      this.hub.send({ type: "switch-model", model: text.split(" ")[1] });
      this.inputEl.value = "";
      return;
    }
    if (text === "/abort" || text === "/stop") {
      this.hub.send({ type: "abort" });
      this.inputEl.value = "";
      return;
    }

    this.inputEl.value = "";
    this.addMessage("user", text);
    this.hub.send({ type: "chat-message", message: text });
  }

  // ── Session history ─────────────────────────────────────
  _requestHistory(sessionName, file = null) {
    if (!sessionName) return;
    if (!this.hub.connected) return;
    const payload = { type: "get-history", session: sessionName, limit: 200 };
    if (file) payload.file = file;
    this.hub.send(payload);
  }

  _renderHistory(entries) {
    this.messagesEl.empty();
    this.currentAssistantMsg = null;
    this.currentToolEls.clear();

    // Map toolCallId → tool DOM element so toolResult entries can attach.
    const toolEls = new Map();

    for (const entry of entries) {
      if (!entry || entry.type !== "message" || !entry.message) continue;
      const m = entry.message;

      if (m.role === "user") {
        const text = (m.content || [])
          .filter(c => c.type === "text")
          .map(c => c.text)
          .join("\n");
        if (text.trim()) this.addMessage("user", text);
        continue;
      }

      if (m.role === "assistant") {
        const turn = this._createTurn("assistant");
        const textEl = turn.querySelector(".pi-cockpit-turn-text");

        let textBuf = "";
        let thinkBuf = "";
        const toolParts = [];

        for (const part of (m.content || [])) {
          if (part.type === "text" && part.text) {
            textBuf += (textBuf ? "\n\n" : "") + part.text;
          } else if (part.type === "thinking" && part.thinking) {
            thinkBuf += (thinkBuf ? "\n" : "") + part.thinking;
          } else if (part.type === "toolCall") {
            toolParts.push(part);
          }
        }

        if (thinkBuf || toolParts.length) {
          const activity = this._ensureActivity(turn);
          activity.wrap.classList.remove("open"); // history: collapsed by default

          if (thinkBuf) {
            const thinkEl = this._ensureThinkingBlock(activity.body);
            thinkEl.setText(thinkBuf);
          }
          for (const part of toolParts) {
            const toolEl = activity.body.createDiv({ cls: "pi-cockpit-tool" });
            const header = toolEl.createDiv({ cls: "pi-cockpit-tool-header" });
            header.createSpan({ cls: "pi-cockpit-tool-name", text: part.name || "tool" });
            const summary = this._toolSummary(part.arguments);
            if (summary) header.createSpan({ cls: "pi-cockpit-role-meta", text: summary });
            header.createSpan({ cls: "pi-cockpit-tool-status done", text: "done" });
            const output = toolEl.createDiv({ cls: "pi-cockpit-tool-output" });
            const argsText = part.arguments && Object.keys(part.arguments).length
              ? JSON.stringify(part.arguments, null, 2)
              : "";
            output.setText(argsText);
            header.addEventListener("click", () => output.classList.toggle("open"));
            if (part.id) toolEls.set(part.id, { toolEl, header, output });
          }
          this._updateActivitySummary(turn);
        }

        if (textBuf) {
          this._renderMarkdownInto(textEl, textBuf, false);
        } else {
          textEl.remove();
        }
        continue;
      }

      if (m.role === "toolResult") {
        const entry2 = toolEls.get(m.toolCallId);
        const text = (m.content || [])
          .filter(c => c.type === "text")
          .map(c => c.text)
          .join("\n");
        if (entry2) {
          const trimmed = text.length > 800 ? text.slice(0, 800) + "\n…" : text;
          entry2.output.setText(trimmed);
        }
        continue;
      }
    }

    this._scrollBottom();
  }
}

// ───────────────────────── Plugin ─────────────────────────

class PiCockpitPlugin extends obsidian.Plugin {
  async onload() {
    this.hub = new HubClient();
    this.hub.connect();

    // Make plugin reachable from views (for cross-view widget opens).
    const self = this;
    this.registerView(VIEW_SESSIONS, (leaf) => { const v = new SessionsView(leaf, self.hub); v.plugin = self; return v; });
    this.registerView(VIEW_CHAT,     (leaf) => { const v = new ChatView(leaf, self.hub);     v.plugin = self; return v; });
    this.registerView(VIEW_SKILLS,   (leaf) => { const v = new SkillsView(leaf, self.hub);   v.plugin = self; return v; });
    this.registerView(VIEW_MODEL,    (leaf) => { const v = new ModelView(leaf, self.hub);    v.plugin = self; return v; });
    this.registerView(VIEW_CRON,     (leaf) => { const v = new CronView(leaf, self.hub);     v.plugin = self; return v; });
    this.registerView(VIEW_TICKETS,  (leaf) => { const v = new TicketsView(leaf, self.hub);  v.plugin = self; return v; });

    this.addRibbonIcon("folder",         "PI Sessions",  () => this.openWidget("session-switcher"));
    this.addRibbonIcon("message-square", "Vault Chat",   () => this.openWidget("vault-chat"));

    this.addCommand({ id: "open-sessions", name: "Open PI Sessions",  callback: () => this.openWidget("session-switcher") });
    this.addCommand({ id: "open-chat",     name: "Open Vault Chat",    callback: () => this.openWidget("vault-chat") });
    this.addCommand({ id: "open-skills",   name: "Open Skills",        callback: () => this.openWidget("skills-directory") });
    this.addCommand({ id: "open-model",    name: "Open Model Switcher",callback: () => this.openWidget("model-switcher") });
    this.addCommand({ id: "open-cron",     name: "Open Cron Dashboard",callback: () => this.openWidget("cron-dashboard") });
    this.addCommand({ id: "open-tickets",  name: "Open Tickets",       callback: () => this.openWidget("tickets") });

    // Plugin also responds to hub-relayed open-widget messages (from web widgets)
    this.unsubOpenWidget = this.hub.on("open-widget", (msg) => {
      if (msg && msg.widget) this.openWidget(msg.widget);
    });

    console.log("[PI Cockpit] Loaded (native ItemView mode)");
  }

  async onunload() {
    if (this.unsubOpenWidget) try { this.unsubOpenWidget(); } catch {}
    this.hub.disconnect();
    // Detach any open PI Cockpit leaves so they don't dangle
    for (const t of [VIEW_SESSIONS, VIEW_CHAT, VIEW_SKILLS, VIEW_MODEL, VIEW_CRON, VIEW_TICKETS]) {
      this.app.workspace.detachLeavesOfType(t);
    }
    // Drop the injected style tag so a fresh load re-applies updated CSS
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
    console.log("[PI Cockpit] Unloaded");
  }

  async openWidget(widgetName) {
    const viewType = WIDGET_TO_VIEW[widgetName];
    if (!viewType) {
      new obsidian.Notice(`Unknown widget: ${widgetName}`);
      return;
    }

    const { workspace } = this.app;

    // Reuse existing leaf if already open
    const existing = workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Sessions → right sidebar; everything else → tab
    let leaf;
    if (viewType === VIEW_SESSIONS) {
      leaf = workspace.getRightLeaf(false);
    } else {
      leaf = workspace.getLeaf("tab");
    }
    if (!leaf) return;

    await leaf.setViewState({ type: viewType, active: true });
    workspace.revealLeaf(leaf);
  }
}

module.exports = PiCockpitPlugin;
