/**
 * {{AGENT_NAME}} — Shared utilities
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** Safely format a token count for display */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

/** Currently connected Tailscale devices */
export interface TailscaleDevice {
  name: string;
  ip: string;
  os: string;
  status: string;
}

/** Parse a file path relative to the user's home */
export function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Read JSON with error handling */
export function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    const resolved = expandHome(filePath);
    if (!fs.existsSync(resolved)) return fallback;
    return JSON.parse(fs.readFileSync(resolved, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Write JSON atomically */
export function writeJsonSafe(filePath: string, data: unknown): boolean {
  try {
    const resolved = expandHome(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = resolved + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, resolved);
    return true;
  } catch {
    return false;
  }
}

/** List all keys in a directory of JSON files */
export function listJsonDir(dirPath: string): string[] {
  try {
    const resolved = expandHome(dirPath);
    if (!fs.existsSync(resolved)) return [];
    return fs
      .readdirSync(resolved)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
