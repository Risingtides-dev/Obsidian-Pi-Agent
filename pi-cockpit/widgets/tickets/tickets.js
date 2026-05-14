// Tickets widget — talks to pi-cockpit hub over WebSocket.

import { connect } from "../shared/ws-client.js";

const hub = connect("tickets");
window.hub = hub;

// ── State ───────────────────────────────────────────────────
let tickets = [];
let meta = { states: [], labels: [], users: [], projects: [] };
let priorityLabels = { 0: "None", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
let activeView = "list";
let activeIdentifier = null;
let editing = null;            // ticket being edited, or {} for new
let paletteIndex = 0;

const filters = {
  search: "",
  groupBy: "state",
  sortBy: "priority",
  state: "",
  assignee: "",
};

// ── DOM helpers ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── Connection ──────────────────────────────────────────────
hub.on("connected", () => {
  $("statusDot").className = "status-dot connected";
  $("connectionText").textContent = "Connected";
  hub.send({ type: "tickets-refresh" });
});

hub.on("disconnected", () => {
  $("statusDot").className = "status-dot disconnected";
  $("connectionText").textContent = "Reconnecting…";
});

hub.on("tickets-snapshot", (data) => {
  tickets = data.tickets || [];
  if (data.meta) meta = data.meta;
  if (data.priorityLabels) priorityLabels = data.priorityLabels;
  hydrateOptions();
  render();
});

hub.on("ticket-detail", (data) => {
  if (data.identifier !== activeIdentifier) return;
  renderDetail(data.ticket, data.comments || [], data.history || []);
});

hub.on("ticket-comments", (data) => {
  if (data.identifier !== activeIdentifier) return;
  renderComments(data.comments || []);
});

hub.on("ticket-saved", () => toast("Saved"));
hub.on("ticket-deleted", () => { closeDetail(); closeEditModal(); toast("Deleted"); });
hub.on("error", (data) => toast(data.message || "Error", "error"));

// ── Filter / control wiring ────────────────────────────────
$("searchInput").addEventListener("input", e => { filters.search = e.target.value; render(); });
$("groupBySelect").addEventListener("change", e => { filters.groupBy = e.target.value; render(); });
$("sortBySelect").addEventListener("change", e => { filters.sortBy = e.target.value; render(); });
$("filterStateSelect").addEventListener("change", e => { filters.state = e.target.value; render(); });
$("filterAssigneeSelect").addEventListener("change", e => { filters.assignee = e.target.value; render(); });

document.querySelectorAll(".view-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".view-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeView = tab.dataset.view;
    render();
  });
});

$("btnCreate").addEventListener("click", () => openEditModal(null));
$("saveBtn").addEventListener("click", saveFromModal);
$("deleteBtn").addEventListener("click", () => {
  if (!editing?.identifier) return;
  if (!confirm(`Delete ${editing.identifier}?`)) return;
  hub.send({ type: "ticket-delete", identifier: editing.identifier });
});
$("editFromDetailBtn").addEventListener("click", () => {
  const t = tickets.find(t => t.identifier === activeIdentifier);
  if (t) openEditModal(t);
});
$("commentSendBtn").addEventListener("click", sendComment);
$("commentInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); }
});

document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", e => {
  e.target.closest(".modal").classList.remove("open");
}));

// ── Keyboard shortcuts ─────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Ignore shortcuts when typing in a field
  const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

  // Cmd-K / Ctrl-K always opens palette (even from fields)
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    togglePalette(true);
    return;
  }
  // Esc closes modals
  if (e.key === "Escape") {
    document.querySelectorAll(".modal.open").forEach(m => m.classList.remove("open"));
    return;
  }
  if (inField) return;

  if (e.key === "c" || e.key === "C") {
    e.preventDefault();
    openEditModal(null);
  } else if (e.key === "/" || e.key === "f") {
    e.preventDefault();
    $("searchInput").focus();
  }
});

// ── Hydrate option lists from meta ─────────────────────────
function hydrateOptions() {
  // State filter + state select
  const stateSelect = $("stateSelect");
  const filterStateSelect = $("filterStateSelect");
  stateSelect.innerHTML = meta.states.map(s => `<option value="${s.id}">${escape(s.name)}</option>`).join("");
  filterStateSelect.innerHTML = `<option value="">All status</option>` +
    meta.states.map(s => `<option value="${s.id}">${escape(s.name)}</option>`).join("");

  // Assignee
  const assigneeSelect = $("assigneeSelect");
  const filterAssigneeSelect = $("filterAssigneeSelect");
  const assigneeOptions = `<option value="">— Unassigned</option>` +
    meta.users.map(u => `<option value="${u.id}">${u.avatar || "👤"} ${escape(u.name)}</option>`).join("");
  assigneeSelect.innerHTML = assigneeOptions;
  filterAssigneeSelect.innerHTML = `<option value="">All assignees</option>` +
    meta.users.map(u => `<option value="${u.id}">${u.avatar || "👤"} ${escape(u.name)}</option>`).join("");

  // Parent select — populated when modal opens

  // Label picker built per-modal-open
}

// ── Filtering + grouping ───────────────────────────────────
function visibleTickets() {
  const q = filters.search.trim().toLowerCase();
  return tickets
    .filter(t => {
      if (q && !(t.title?.toLowerCase().includes(q) || t.identifier?.toLowerCase().includes(q))) return false;
      if (filters.state && t.state !== filters.state) return false;
      if (filters.assignee && t.assignee !== filters.assignee) return false;
      return true;
    })
    .sort((a, b) => {
      switch (filters.sortBy) {
        case "priority":
          return (priorityRank(a.priority) - priorityRank(b.priority)) || (a.title || "").localeCompare(b.title || "");
        case "updated":
          return (b.updated_at || "").localeCompare(a.updated_at || "");
        case "created":
          return (b.created_at || "").localeCompare(a.created_at || "");
        case "title":
          return (a.title || "").localeCompare(b.title || "");
        default:
          return 0;
      }
    });
}

function priorityRank(p) {
  // 1 (urgent) first, 0 (none) last
  if (p === 0 || p == null) return 999;
  return p;
}

function groupTickets(list) {
  if (filters.groupBy === "none") return [{ key: "", label: "All", items: list }];
  const groups = new Map();
  for (const t of list) {
    let key = "—";
    let label = "—";
    switch (filters.groupBy) {
      case "state": {
        const s = meta.states.find(s => s.id === t.state);
        key = t.state || "_";
        label = s ? s.name : (t.state || "—");
        break;
      }
      case "assignee": {
        const u = meta.users.find(u => u.id === t.assignee);
        key = t.assignee || "_";
        label = u ? `${u.avatar || ""} ${u.name}` : "Unassigned";
        break;
      }
      case "priority":
        key = String(t.priority ?? 0);
        label = priorityLabels[t.priority ?? 0] || "—";
        break;
      case "label":
        // tickets w/ multiple labels appear in multiple groups
        for (const l of (t.labels || ["_unlabeled"])) {
          const k = l;
          if (!groups.has(k)) groups.set(k, { key: k, label: k === "_unlabeled" ? "No label" : k, items: [] });
          groups.get(k).items.push(t);
        }
        continue;
    }
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(t);
  }
  // Order groups
  const arr = [...groups.values()];
  if (filters.groupBy === "state") {
    arr.sort((a, b) => {
      const aPos = meta.states.find(s => s.id === a.key)?.position ?? 99;
      const bPos = meta.states.find(s => s.id === b.key)?.position ?? 99;
      return aPos - bPos;
    });
  } else if (filters.groupBy === "priority") {
    arr.sort((a, b) => priorityRank(parseInt(a.key) || 0) - priorityRank(parseInt(b.key) || 0));
  }
  return arr;
}

// ── Render ─────────────────────────────────────────────────
function render() {
  const list = visibleTickets();
  $("countLabel").textContent = `${list.length} ticket${list.length === 1 ? "" : "s"}`;

  const body = $("mainBody");
  if (tickets.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎫</div>
        <div>No tickets yet. Press <b>C</b> to create one.</div>
      </div>`;
    return;
  }

  if (activeView === "board") {
    body.innerHTML = renderBoard(list);
    wireBoardDnD();
  } else {
    body.innerHTML = renderList(list);
  }
  body.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });
}

function renderList(list) {
  const groups = groupTickets(list);
  return groups.map(g => `
    <div class="ticket-group">
      <div class="ticket-group-header">
        <span>${escape(g.label)}</span>
        <span class="ticket-group-count">${g.items.length}</span>
      </div>
      ${g.items.map(renderTicketRow).join("")}
    </div>
  `).join("");
}

function renderTicketRow(t) {
  const state = meta.states.find(s => s.id === t.state);
  const stateColor = state?.color || "#888";
  const user = meta.users.find(u => u.id === t.assignee);
  const labels = (t.labels || []).slice(0, 2).map(l => {
    const meta_l = meta.labels.find(ml => ml.id === l || ml.name === l);
    const color = meta_l?.color || "#666";
    return `<span class="ticket-label" style="color:${color};border:1px solid ${color}55">${escape(l)}</span>`;
  }).join("");
  const stateClass = `state-${t.state}`;
  return `
    <div class="ticket-row ${stateClass}" data-id="${escape(t.identifier)}">
      <span class="ticket-id">${escape(t.identifier)}</span>
      <span class="priority-dot priority-${t.priority ?? 0}" title="${escape(priorityLabels[t.priority ?? 0])}">
        ${priorityIcon(t.priority)}
      </span>
      <span class="status-pill" style="color:${stateColor};background:${stateColor}22">${escape(state?.name || t.state || "—")}</span>
      <span class="ticket-title">${escape(t.title)}</span>
      <span class="ticket-labels">${labels}</span>
      <span class="ticket-assignee" title="${escape(user?.name || "Unassigned")}">${user?.avatar || "·"}</span>
      <span class="ticket-meta">${timeAgo(t.updated_at)}</span>
    </div>
  `;
}

function priorityIcon(p) {
  switch (p) {
    case 1: return "▲";
    case 2: return "▲";
    case 3: return "▬";
    case 4: return "▼";
    default: return "·";
  }
}

function renderBoard(list) {
  const stateGroups = meta.states.map(s => ({
    state: s,
    items: list.filter(t => t.state === s.id),
  }));
  return `
    <div class="board">
      ${stateGroups.map(g => `
        <div class="board-column" data-state="${escape(g.state.id)}">
          <div class="board-column-header">
            <span style="color:${g.state.color}">●</span>
            <span>${escape(g.state.name)}</span>
            <span class="count">${g.items.length}</span>
          </div>
          <div class="board-cards">
            ${g.items.map(t => `
              <div class="board-card" draggable="true" data-id="${escape(t.identifier)}">
                <div class="board-card-header">
                  <span class="board-card-id">${escape(t.identifier)}</span>
                  <span class="priority-dot priority-${t.priority ?? 0}">${priorityIcon(t.priority)}</span>
                </div>
                <div class="board-card-title">${escape(t.title)}</div>
                <div class="board-card-footer">
                  <span class="ticket-labels">
                    ${(t.labels || []).slice(0, 2).map(l => `<span class="ticket-label">${escape(l)}</span>`).join("")}
                  </span>
                  <span class="ticket-assignee">${(meta.users.find(u => u.id === t.assignee))?.avatar || ""}</span>
                </div>
              </div>`).join("")}
          </div>
        </div>`).join("")}
    </div>
  `;
}

function wireBoardDnD() {
  document.querySelectorAll(".board-card").forEach(card => {
    card.addEventListener("dragstart", e => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/identifier", card.dataset.id);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });
  document.querySelectorAll(".board-column").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", e => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/identifier");
      const newState = col.dataset.state;
      hub.send({ type: "ticket-transition", identifier: id, state: newState, actor: "john" });
    });
  });
}

// ── Edit modal ─────────────────────────────────────────────
function openEditModal(t) {
  editing = t ? { ...t } : { state: meta.states[1]?.id || "todo", priority: 0, labels: [] };
  $("modalTitle").textContent = t ? `Edit ${t.identifier}` : "New ticket";
  $("titleInput").value = editing.title || "";
  $("descInput").value = stripTitle(editing.description || "");
  $("stateSelect").value = editing.state || "todo";
  $("prioritySelect").value = String(editing.priority ?? 0);
  $("assigneeSelect").value = editing.assignee || "";
  $("estimateInput").value = editing.estimate ?? "";
  $("dueDateInput").value = editing.due_date || "";
  $("identifierInput").value = editing.identifier || "(auto)";
  $("parentSelect").innerHTML = `<option value="">— None</option>` +
    tickets.filter(x => x.identifier !== editing.identifier).map(x =>
      `<option value="${escape(x.identifier)}">${escape(x.identifier)} · ${escape(x.title)}</option>`
    ).join("");
  $("parentSelect").value = editing.parent || "";
  renderLabelPicker(editing.labels || []);
  $("deleteBtn").style.display = editing.identifier ? "" : "none";
  $("editModal").classList.add("open");
  setTimeout(() => $("titleInput").focus(), 50);
}

function closeEditModal() { $("editModal").classList.remove("open"); editing = null; }

function stripTitle(desc) {
  // The monitor stores `# Title\n\nbody`. Strip the heading for editing.
  const m = desc.match(/^#\s+.+\n\n?([\s\S]*)$/);
  return m ? m[1] : desc;
}

function renderLabelPicker(selected) {
  const set = new Set(selected);
  $("labelPicker").innerHTML = meta.labels.map(l => `
    <span class="label-chip ${set.has(l.id) || set.has(l.name) ? "selected" : ""}"
          data-label="${escape(l.id || l.name)}"
          style="${set.has(l.id) || set.has(l.name) ? `color:${l.color};border-color:${l.color}` : ""}">
      ${escape(l.name)}
    </span>
  `).join("");
  $("labelPicker").querySelectorAll(".label-chip").forEach(c => {
    c.addEventListener("click", () => c.classList.toggle("selected"));
  });
}

function readSelectedLabels() {
  return [...$("labelPicker").querySelectorAll(".label-chip.selected")].map(c => c.dataset.label);
}

function saveFromModal() {
  const payload = {
    identifier: editing.identifier || undefined,
    title: $("titleInput").value.trim(),
    description: $("descInput").value,
    state: $("stateSelect").value,
    priority: parseInt($("prioritySelect").value, 10),
    assignee: $("assigneeSelect").value || null,
    estimate: $("estimateInput").value ? parseInt($("estimateInput").value, 10) : null,
    due_date: $("dueDateInput").value || null,
    parent: $("parentSelect").value || null,
    labels: readSelectedLabels(),
  };
  if (!payload.title) { toast("Title required", "error"); return; }
  hub.send({ type: "ticket-save", ticket: payload });
  closeEditModal();
}

// ── Detail panel ───────────────────────────────────────────
function openDetail(identifier) {
  activeIdentifier = identifier;
  $("detailModal").classList.add("open");
  hub.send({ type: "ticket-get", identifier });
}

function closeDetail() { activeIdentifier = null; $("detailModal").classList.remove("open"); }

function renderDetail(t, comments, history) {
  if (!t) return;
  const state = meta.states.find(s => s.id === t.state);
  const user = meta.users.find(u => u.id === t.assignee);
  $("detailHeader").textContent = t.identifier;
  $("detailTitle").textContent = t.title;
  $("detailDescription").textContent = stripTitle(t.description || "");
  $("detailState").style.color = state?.color || "";
  $("detailState").style.background = (state?.color || "") + "22";
  $("detailState").textContent = state?.name || t.state || "—";
  $("detailPriority").textContent = `${priorityIcon(t.priority)} ${priorityLabels[t.priority ?? 0] || "—"}`;
  $("detailAssignee").textContent = user ? `${user.avatar || ""} ${user.name}` : "Unassigned";
  $("detailLabels").innerHTML = (t.labels || []).map(l => `<span class="ticket-label">${escape(l)}</span>`).join(" ") || "—";
  $("detailEstimate").textContent = t.estimate ?? "—";
  $("detailDue").textContent = t.due_date || "—";
  $("detailParent").textContent = t.parent || "—";
  $("detailCreated").textContent = fmtDate(t.created_at);
  $("detailUpdated").textContent = fmtDate(t.updated_at);
  renderComments(comments);
  renderHistory(history);
}

function renderComments(comments) {
  $("detailComments").innerHTML = comments.length
    ? comments.map(c => `
        <div class="comment">
          <div class="comment-meta">
            <span>${escape(c.author || "—")}</span>
            <span>${fmtDate(c.created_at)}</span>
          </div>
          <div class="comment-body">${escape(c.body || "")}</div>
        </div>`).join("")
    : `<div style="font-size:11px;color:var(--text-muted);">No comments yet.</div>`;
}

function renderHistory(history) {
  if (!history.length) {
    $("detailHistory").innerHTML = `<div style="font-size:10px;color:var(--text-muted);">No activity yet.</div>`;
    return;
  }
  $("detailHistory").innerHTML = history.slice().reverse().map(h => `
    <div class="history-entry">
      <span class="history-actor">${escape(h.actor)}</span>
      <span>${describeHistory(h)}</span>
      <span class="history-time">${fmtDate(h.at)}</span>
    </div>
  `).join("");
}

function describeHistory(h) {
  switch (h.field) {
    case "created": return "created the ticket";
    case "state": return `moved status: <code>${escape(h.from || "—")}</code> → <code>${escape(h.to)}</code>`;
    case "comment": return "commented";
    default: return `${escape(h.field)}: ${escape(h.from || "")} → ${escape(h.to || "")}`;
  }
}

function sendComment() {
  const body = $("commentInput").value.trim();
  if (!body || !activeIdentifier) return;
  hub.send({ type: "ticket-comment-add", identifier: activeIdentifier, body, author: "john" });
  $("commentInput").value = "";
}

// ── Palette (Cmd-K) ────────────────────────────────────────
function togglePalette(open) {
  if (open) {
    $("paletteModal").classList.add("open");
    $("paletteInput").value = "";
    paletteIndex = 0;
    renderPalette("");
    setTimeout(() => $("paletteInput").focus(), 30);
  } else {
    $("paletteModal").classList.remove("open");
  }
}
$("paletteInput")?.addEventListener("input", e => renderPalette(e.target.value));
$("paletteInput")?.addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { paletteIndex = Math.min(paletteIndex + 1, paletteResults.length - 1); highlightPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { paletteIndex = Math.max(paletteIndex - 1, 0); highlightPalette(); e.preventDefault(); }
  else if (e.key === "Enter") {
    const r = paletteResults[paletteIndex];
    if (r) {
      if (r.action === "create") { togglePalette(false); openEditModal(null); $("titleInput").value = r.label; }
      else { togglePalette(false); openDetail(r.id); }
    }
  }
});

let paletteResults = [];
function renderPalette(q) {
  const ql = q.toLowerCase().trim();
  const matches = tickets
    .filter(t => !ql || t.title?.toLowerCase().includes(ql) || t.identifier?.toLowerCase().includes(ql))
    .slice(0, 20)
    .map(t => ({ id: t.identifier, label: `${t.identifier} · ${t.title}`, ticket: t }));
  paletteResults = matches.length === 0 && ql
    ? [{ action: "create", label: q, id: "_create" }]
    : matches;
  if (ql && matches.length > 0) paletteResults.push({ action: "create", label: q, id: "_create" });
  $("paletteResults").innerHTML = paletteResults.map((r, i) => `
    <div class="palette-row ${i === paletteIndex ? "active" : ""}" data-idx="${i}">
      ${r.action === "create"
        ? `<span class="ticket-id">＋</span><span>Create: "${escape(r.label)}"</span>`
        : `<span class="ticket-id">${escape(r.ticket.identifier)}</span>
           <span class="priority-dot priority-${r.ticket.priority ?? 0}">${priorityIcon(r.ticket.priority)}</span>
           <span>${escape(r.ticket.title)}</span>`}
    </div>
  `).join("");
  $("paletteResults").querySelectorAll(".palette-row").forEach(row => {
    row.addEventListener("click", () => {
      paletteIndex = parseInt(row.dataset.idx, 10);
      const r = paletteResults[paletteIndex];
      if (r.action === "create") { togglePalette(false); openEditModal(null); $("titleInput").value = r.label; }
      else { togglePalette(false); openDetail(r.id); }
    });
  });
}
function highlightPalette() {
  $("paletteResults").querySelectorAll(".palette-row").forEach((row, i) => {
    row.classList.toggle("active", i === paletteIndex);
  });
}

// ── Helpers ────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `
    position:fixed;bottom:12px;left:50%;transform:translateX(-50%);
    padding:6px 14px;border-radius:6px;font-size:11px;z-index:999;
    background:var(--bg-active);border:1px solid ${kind === "error" ? "var(--danger)" : "var(--accent)"};
    color:${kind === "error" ? "var(--danger)" : "var(--accent)"};
    animation:toastIn 0.2s ease-out, toastOut 0.2s ease-in 2s forwards;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// ── Boot ───────────────────────────────────────────────────
render();
