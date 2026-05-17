/**
 * {{AGENT_NAME}} — Worktree Context
 *
 * On session_start in ~/dev/{{AGENT_NAME}}*, silently sets:
 *   - git_status (branch, worktree indicator, github)
 *   - vault_path (main repo for note reads)
 *   - session name ({{AGENT_NAME}} · branch)
 */

import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const THOTH_ROOT = joinPath(homedir(), "dev", "{{AGENT_NAME}}");
const WORKTREE_DIR = joinPath(homedir(), ".worktrees");
const CONTEXT_DIR = joinPath(homedir(), ".pi", "agent", "extensions", "{{AGENT_NAME_LOWER}}", "context");

function is{{AGENT_NAME}}Dir(cwd: string): boolean {
  const norm = (p: string) => p.toLowerCase();
  const c = norm(cwd);
  return c === norm(THOTH_ROOT) || c.startsWith(norm(THOTH_ROOT) + "/") || c.startsWith(norm(WORKTREE_DIR) + "/{{AGENT_NAME_LOWER}}");
}

async function git(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string> {
  const r = await pi.exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git failed");
  return r.stdout.trim();
}

function writeCtx(key: string, value: string): void {
  mkdirSync(CONTEXT_DIR, { recursive: true });
  writeFileSync(joinPath(CONTEXT_DIR, `${key}.json`), JSON.stringify(value));
}

function isWorktree(cwd: string): boolean {
  try {
    return existsSync(joinPath(cwd, ".git")) && statSync(joinPath(cwd, ".git")).isFile();
  } catch { return false; }
}

// ── Session browser for /wt command ──────────────────────────

function encodeSessionDir(p: string): string {
  return "--" + p.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function sessionDir(p: string): string {
  return joinPath(homedir(), ".pi", "agent", "sessions", encodeSessionDir(p));
}

function reltime(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

function sessionName(file: string): string {
  try {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.customType === "set_session_name" && entry.details?.name) {
          return entry.details.name;
        }
      } catch { continue; }
    }
  } catch {}
  return "session";
}

interface WtOption {
  label: string;
  action: "resume" | "new";
  sessionPath?: string;
  worktreePath: string;
}

async function buildOptions(pi: ExtensionAPI, cwd: string): Promise<WtOption[]> {
  const opts: WtOption[] = [];

  let list: string;
  try { list = await git(pi, cwd, ["worktree", "list"]); }
  catch { return opts; }

  for (const line of list.split("\n")) {
    if (!line.trim()) continue;
    const [wtPath, , branchRaw] = line.split(/\s+/);
    const branch = (branchRaw || "?").replace(/[\[\]]/g, "");
    const isCur = wtPath === cwd ? "📍" : "🌿";
    const sd = sessionDir(wtPath);

    // Sessions
    if (existsSync(sd)) {
      try {
        const files = readdirSync(sd)
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => joinPath(sd, f))
          .sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs)
          .slice(0, 5);

        for (const file of files) {
          const mtime = statSync(file).mtimeMs;
          const name = sessionName(file);
          opts.push({
            label: `${isCur} ${branch} · ${name} · ${reltime(mtime)}`,
            action: "resume",
            sessionPath: file,
            worktreePath: wtPath,
          });
        }
      } catch {}
    }

    // New session
    const note = wtPath === cwd ? "" : " (use {{AGENT_NAME_LOWER}} from terminal)";
    opts.push({
      label: `${isCur} ${branch} · + new session${note}`,
      action: "new",
      worktreePath: wtPath,
    });
  }

  return opts;
}

export async function showWorktreeBrowser(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  if (!is{{AGENT_NAME}}Dir(ctx.cwd)) {
    ctx.ui.notify("/wt is only for the {{AGENT_NAME}} vault", "warning");
    return;
  }

  const opts = await buildOptions(pi, ctx.cwd);
  if (opts.length === 0) {
    ctx.ui.notify("No worktrees found", "warning");
    return;
  }

  const choice = await ctx.ui.select(
    "🧠 Sessions",
    opts.map((o) => o.label)
  );

  if (!choice) return;

  const selected = opts.find((o) => o.label === choice);
  if (!selected) return;

  if (selected.action === "resume" && selected.sessionPath) {
    // Switch session — Pi loads the session file, CWD may update from session metadata
    await ctx.switchSession(selected.sessionPath);
  } else if (selected.action === "new") {
    if (selected.worktreePath === ctx.cwd) {
      // New session in current worktree
      await ctx.newSession();
    } else {
      // Can't cd to another worktree from inside Pi
      ctx.ui.notify(
        `To start a new session in ${selected.worktreePath}:\n\n  exit and run: {{AGENT_NAME_LOWER}}`,
        "info"
      );
    }
  }
}

// ── Vault Context Injection ────────────────────────────────
// Reads core reference docs from the {{AGENT_NAME}} vault and injects them
// into every session so agents always have the full picture.

const VAULT_DOCS = [
  "3-Resources/AGENTS.md",
  "3-Resources/System Prompt.md",
  "3-Resources/{{AGENT_NAME}} - Digital Twin.md",
  "3-Resources/{{AGENT_NAME}} - Obsidian Integration.md",
  "3-Resources/{{AGENT_NAME}} Worktrees.md",
];

export function countVaultDocs(): number {
  return VAULT_DOCS.filter((doc) => existsSync(joinPath(THOTH_ROOT, doc))).length;
}

export function buildVaultContext(): string {
  const lines: string[] = ["## Vault Context (from 3-Resources)"];
  let hasContent = false;

  for (const doc of VAULT_DOCS) {
    const filePath = joinPath(THOTH_ROOT, doc);
    try {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf8").trim();
      if (!content) continue;
      // Truncate huge files to avoid context bloat (200 line / 10KB limit per doc)
      const truncated = content.split("\n").slice(0, 200).join("\n").slice(0, 10240);
      lines.push(`\n### ${doc.replace("3-Resources/", "")}\n${truncated}`);
      hasContent = true;
    } catch { /* file may not exist yet */ }
  }

  return hasContent ? lines.join("\n") : "";
}

export async function onSessionStart(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!is{{AGENT_NAME}}Dir(ctx.cwd)) return;

  try { await git(pi, ctx.cwd, ["rev-parse", "--show-toplevel"]); }
  catch { return; }

  try {
    const branch = await git(pi, ctx.cwd, ["branch", "--show-current"]);
    const wtIcon = isWorktree(ctx.cwd) ? "🔀" : "";
    const gh = await git(pi, ctx.cwd, ["remote", "get-url", "origin"])
      .then((u) => u.includes("github") ? "🐙" : "")
      .catch(() => "");
    const mainVault = await git(pi, ctx.cwd, ["worktree", "list"])
      .then((l) => l.split("\n")[0].split(/\s+/)[0]);

    writeCtx("git_status", `${wtIcon}${branch} ${gh}`);
    writeCtx("vault_path", mainVault);
    pi.setSessionName(`{{AGENT_NAME}} · ${wtIcon}${branch}`);
  } catch { /* best effort */ }
}
