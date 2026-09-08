import { validateContainerNumber as validateIso } from "@/lib/iso6346";
import type { BithyTool } from "@/lib/brains/types";

/** Deterministic validation. The model may request it, but never decides it. */
export const validateContainerNumberTool: BithyTool = {
  id: "validateContainerNumber",
  name: "Validate Container Number",
  description: "Deterministic ISO 6346 validation of an 11-character container number.",
  parameters: {
    type: "object",
    properties: { container_number: { type: "string" } },
    required: ["container_number"],
    output: { valid: "boolean", normalized: "string", owner_code: "string", reason: "string" },
  },
  permissions: ["containertrack:read"],
  destructive: false,
  execute: async (ctx) => {
    const raw = String(ctx.params?.["container_number"] ?? ctx.query ?? "");
    const result = validateIso(raw);
    return {
      ok: result.valid,
      summary: result.valid
        ? `${result.normalized} is a valid ISO 6346 container number.`
        : `${raw} is not a valid container number: ${result.message}`,
      data: result,
      ...(result.valid ? {} : { error: result.message ?? "Invalid container number" }),
    };
  },
};
