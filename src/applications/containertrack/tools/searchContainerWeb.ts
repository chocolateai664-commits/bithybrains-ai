import type { BithyTool } from "@/lib/brains/types";
import { validateContainerNumber } from "@/lib/iso6346";
import { searchContainerSources } from "../services/providers.server";

/**
 * Fallback lookup through an operator-configured search source, restricted to
 * approved hosts. Returned content is untrusted data, never instructions, and
 * no authentication, paywall or anti-bot protection is ever circumvented.
 */
export const searchContainerWebTool: BithyTool = {
  id: "searchContainerWeb",
  name: "Search Container Web Sources",
  description: "Query approved public logistics sources for container status when the provider is unavailable.",
  parameters: {
    type: "object",
    properties: { container_number: { type: "string" } },
    required: ["container_number"],
    output: { source: "object|null", available: "boolean" },
  },
  permissions: ["containertrack:read"],
  destructive: false,
  execute: async (ctx) => {
    const raw = String(ctx.params?.["container_number"] ?? ctx.query ?? "");
    const iso = validateContainerNumber(raw);
    if (!iso.valid) return { ok: false, summary: "", error: "Search requires a valid container number" };

    const source = await searchContainerSources(iso.normalized);
    if (!source) return { ok: false, summary: "", error: "No approved web search source is configured" };
    return { ok: true, summary: `Approved web source returned results for ${iso.normalized}.`, data: { source } };
  },
};
