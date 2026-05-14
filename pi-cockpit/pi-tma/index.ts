import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface TelegramSharedConfig {
	botToken?: string;
	allowedUserId?: number;
	botUsername?: string;
}

interface TmaConfig {
	tunnelBaseUrl?: string;
	artifactsDir?: string;
	defaultChatId?: number;
}

const TELEGRAM_CONFIG_PATH = join(homedir(), ".pi", "agent", "telegram.json");
const TMA_CONFIG_PATH = join(homedir(), ".pi", "agent", "tma.json");

interface TelegramApiResponse<T> {
	ok: boolean;
	result?: T;
	description?: string;
	error_code?: number;
}

interface TelegramSentMessage {
	message_id: number;
	date: number;
}

async function callTelegram<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json()) as TelegramApiResponse<T>;
	if (!data.ok || data.result === undefined) {
		throw new Error(data.description || `Telegram API ${method} failed`);
	}
	return data.result;
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		const content = await readFile(path, "utf8");
		return JSON.parse(content) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
}

async function writeJson(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

export default function (pi: ExtensionAPI) {
	let tmaConfig: TmaConfig = {};
	let telegramConfig: TelegramSharedConfig = {};

	async function loadConfigs(): Promise<void> {
		tmaConfig = (await readJson<TmaConfig>(TMA_CONFIG_PATH)) ?? {};
		telegramConfig = (await readJson<TelegramSharedConfig>(TELEGRAM_CONFIG_PATH)) ?? {};
	}

	function updateStatus(ctx: ExtensionContext): void {
		const label = "tma";
		if (!telegramConfig.botToken) {
			ctx.ui.setStatus("tma", `tma telegram not configured`);
			return;
		}
		if (!tmaConfig.tunnelBaseUrl || !tmaConfig.artifactsDir) {
			ctx.ui.setStatus("tma", `tma run /tma-setup`);
			return;
		}
		ctx.ui.setStatus("tma", `tma ready`);
	}

	function resolveChatId(override?: number): number {
		const chatId = override ?? tmaConfig.defaultChatId ?? telegramConfig.allowedUserId;
		if (!chatId) {
			throw new Error("No chat_id available. Pair pi-telegram first, set tma defaultChatId, or pass chat_id explicitly.");
		}
		return chatId;
	}

	function buildArtifactUrl(path: string): string {
		if (!tmaConfig.tunnelBaseUrl) {
			throw new Error("pi-tma tunnelBaseUrl not configured. Run /tma-setup.");
		}
		const base = tmaConfig.tunnelBaseUrl.replace(/\/+$/, "");
		const cleanPath = path.replace(/^\/+/, "");
		return `${base}/${cleanPath}`;
	}

	async function ensureFileExists(path: string): Promise<string> {
		if (!tmaConfig.artifactsDir) {
			throw new Error("pi-tma artifactsDir not configured. Run /tma-setup.");
		}
		if (path.includes("..")) {
			throw new Error("Path may not contain '..' segments.");
		}
		const fullPath = join(tmaConfig.artifactsDir, path);
		const info = await stat(fullPath).catch(() => null);
		if (!info || !info.isFile()) {
			throw new Error(`Artifact not found at ${fullPath}. Write the file first, then call telegram_send_mini_app.`);
		}
		return fullPath;
	}

	pi.registerTool({
		name: "telegram_send_mini_app",
		label: "Telegram Mini App",
		description: "Send a Telegram message with a Mini App button that opens an artifact in Telegram's WebView.",
		promptSnippet: "Send a Telegram Mini App button pointing at an artifact.",
		promptGuidelines: [
			"Write the artifact file to artifactsDir BEFORE calling this tool.",
			"Prefer telegram_attach for files the user just wants to download.",
			"The path parameter is relative to artifactsDir.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Artifact path relative to artifactsDir" }),
			title: Type.String({ description: "Button label", maxLength: 64 }),
			caption: Type.Optional(Type.String({ description: "Optional text above the button" })),
			chat_id: Type.Optional(Type.Integer({ description: "Telegram chat ID. Defaults to paired user." })),
		}),
		async execute(_toolCallId, params) {
			await loadConfigs();
			const token = telegramConfig.botToken;
			if (!token) throw new Error("Telegram bot token not configured. Configure pi-telegram first.");

			const chatId = resolveChatId(params.chat_id);
			const fullPath = await ensureFileExists(params.path);
			const url = buildArtifactUrl(params.path);

			const sent = await callTelegram<TelegramSentMessage>(token, "sendMessage", {
				chat_id: chatId,
				text: params.caption ?? params.title,
				reply_markup: {
					inline_keyboard: [[{ text: params.title, web_app: { url } }]],
				},
			});

			return {
				content: [{ type: "text", text: `Sent Mini App button "${params.title}" → ${url} (message ${sent.message_id}).` }],
				details: { url, chatId, messageId: sent.message_id, file: fullPath },
			};
		},
	});

	pi.registerCommand("tma-setup", {
		description: "Configure pi-tma tunnel URL and artifacts directory",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await loadConfigs();
			const tunnel = await ctx.ui.input("Tunnel base URL", tmaConfig.tunnelBaseUrl ?? "https://thoth.agentsworld.org");
			if (!tunnel) return;
			const artifacts = await ctx.ui.input("Artifacts directory (absolute path)", tmaConfig.artifactsDir ?? join(homedir(), "dev", "Thoth", "6-Agent", "tma-mini"));
			if (!artifacts) return;
			tmaConfig = { ...tmaConfig, tunnelBaseUrl: tunnel.trim().replace(/\/+$/, ""), artifactsDir: artifacts.trim() };
			await writeJson(TMA_CONFIG_PATH, tmaConfig);
			updateStatus(ctx);
		},
	});

	pi.registerCommand("tma-status", {
		description: "Show pi-tma configuration",
		handler: async (_args, ctx) => {
			await loadConfigs();
			const lines = [
				`tunnel: ${tmaConfig.tunnelBaseUrl ?? "not set"}`,
				`artifacts: ${tmaConfig.artifactsDir ?? "not set"}`,
				`default chat: ${tmaConfig.defaultChatId ?? telegramConfig.allowedUserId ?? "not paired"}`,
			];
			ctx.ui.notify(lines.join(" | "), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await loadConfigs();
		updateStatus(ctx);
	});
}
