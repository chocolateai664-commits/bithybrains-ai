import { OutboundUrlError } from "@/lib/brains/net.server";
import type { BithyTool } from "@/lib/brains/types";
import { validateContainerNumber } from "@/lib/iso6346";
import {
  ProviderUnavailable,
  developmentFixturesEnabled,
  developmentTrackingSource,
  fetchProviderTracking,
  providerConfig,
} from "../services/providers.server";

/**
 * Retrieves raw tracking data from the configured provider. Never fabricates a
 * result: with no provider configured the tool reports unavailability.
 */
export const trackContainerTool: BithyTool = {
  id: "trackContainer",
  name: "Track Container",
  description: "Retrieve container status from the configured tracking provider.",
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
    if (!iso.valid) return { ok: false, summary: "", error: "Tracking requires a valid container number" };

    if (!providerConfig()) {
      if (developmentFixturesEnabled()) {
        const source = developmentTrackingSource(iso.normalized, String(ctx.params?.["carrier"] ?? "") || null);
        return { ok: true, summary: "DEVELOPMENT DATA — NOT LIVE TRACKING", data: { source, development: true } };
      }
      return { ok: false, summary: "", error: "No tracking provider is configured" };
    }

    try {
      const source = await fetchProviderTracking(iso.normalized);
      return { ok: true, summary: `Provider ${source.name} returned data for ${iso.normalized}.`, data: { source } };
    } catch (error) {
      if (error instanceof OutboundUrlError) {
        return { ok: false, summary: "", error: `Provider endpoint rejected by connector policy: ${error.message}` };
      }
      if (error instanceof ProviderUnavailable) return { ok: false, summary: "", error: error.message };
      return { ok: false, summary: "", error: "Tracking provider could not be reached" };
    }
  },
};
