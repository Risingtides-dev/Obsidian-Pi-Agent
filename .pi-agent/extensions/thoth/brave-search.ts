/**
 * Thoth — Brave Search Integration
 *
 * Web search tool powered by Brave Search API.
 * Provides up-to-date web results for research, fact-checking,
 * and current event awareness.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
    total?: number;
  };
  news?: {
    results: BraveWebResult[];
  };
}

export function registerBraveSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "thoth_search",
    label: "Web Search",
    description:
      "Search the web using Brave Search API. Returns up-to-date results for current events, fact-checking, documentation lookups, and general research. Use this when you need information beyond your training data cutoff or want to verify current facts.",
    promptSnippet: "Search the web for current information, documentation, or research",
    promptGuidelines: [
      "Use thoth_search to find current information, documentation, or verify facts beyond your training data.",
      "Use thoth_search when the user asks about recent events, latest versions, or current documentation.",
      "Prefer thoth_search over guessing when you're uncertain about current facts.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (be specific and include relevant keywords)" }),
      count: Type.Optional(
        Type.Number({ description: "Number of results to return (default 5, max 20)", minimum: 1, maximum: 20 }),
      ),
      offset: Type.Optional(Type.Number({ description: "Pagination offset (default 0)", minimum: 0 })),
      newsOnly: Type.Optional(
        Type.Boolean({ description: "Only return news results (default false)", default: false }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate) {
      const count = params.count ?? 5;
      const offset = params.offset ?? 0;
      const newsOnly = params.newsOnly ?? false;

      const url = new URL(BRAVE_API_URL);
      url.searchParams.set("q", params.query);
      url.searchParams.set("count", String(Math.min(count, 20)));
      if (offset > 0) url.searchParams.set("offset", String(offset));
      if (newsOnly) url.searchParams.set("freshness", "pw"); // past week
      url.searchParams.set("search_lang", "en");

      try {
        const response = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY,
          },
          signal: signal ?? undefined,
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `Brave Search error (${response.status}): ${errorText.slice(0, 300)}`,
              },
            ],
            details: { error: true, status: response.status },
          };
        }

        const data = (await response.json()) as BraveSearchResponse;

        // Format results
        const results = data.web?.results ?? [];
        const news = data.news?.results ?? [];

        if (results.length === 0 && news.length === 0) {
          return {
            content: [{ type: "text", text: `🔍 No results found for "${params.query}".` }],
            details: { query: params.query, totalResults: 0 },
          };
        }

        const lines: string[] = [];

        // Web results
        if (results.length > 0) {
          lines.push(`## Web Results for "${params.query}"\n`);
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const age = r.age ? ` (${r.age})` : "";
            lines.push(`### ${i + 1}. [${r.title}](${r.url})${age}`);
            lines.push(`${r.description}`);
            if (r.extra_snippets?.length) {
              for (const snippet of r.extra_snippets.slice(0, 2)) {
                lines.push(`  > ${snippet}`);
              }
            }
            lines.push("");
          }
        }

        // News results (if requested or available)
        if (news.length > 0 && (newsOnly || results.length === 0)) {
          lines.push(`## News Results\n`);
          for (let i = 0; i < Math.min(news.length, 5); i++) {
            const r = news[i];
            const age = r.age ? ` (${r.age})` : "";
            lines.push(`### ${i + 1}. [${r.title}](${r.url})${age}`);
            lines.push(`${r.description}`);
            lines.push("");
          }
        }

        const total = data.web?.total ?? results.length;

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n").trim(),
            },
          ],
          details: {
            query: params.query,
            totalResults: total,
            returnedResults: results.length + news.length,
            results,
            news,
          },
        };
      } catch (error: any) {
        if (error.name === "AbortError") {
          return {
            content: [{ type: "text", text: "Search cancelled." }],
            details: { cancelled: true },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Search failed: ${error.message || "Unknown error"}`,
            },
          ],
          details: { error: true, message: error.message },
        };
      }
    },
  });
}
