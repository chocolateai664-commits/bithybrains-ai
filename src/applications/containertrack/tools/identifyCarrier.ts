import { validateContainerNumber } from "@/lib/iso6346";
import type { BithyTool } from "@/lib/brains/types";
import { carrierForOwnerCode, isLessorOwnerCode } from "../carriers";

export const identifyCarrierTool: BithyTool = {
  id: "identifyCarrier",
  name: "Identify Carrier",
  description: "Resolve the ocean carrier from the container's ISO 6346 owner code.",
  parameters: {
    type: "object",
    properties: { container_number: { type: "string" } },
    required: ["container_number"],
    output: { carrier: "string|null", owner_code: "string", lessor_owned: "boolean" },
  },
  permissions: ["containertrack:read"],
  destructive: false,
  execute: async (ctx) => {
    const raw = String(ctx.params?.["container_number"] ?? ctx.query ?? "");
    const iso = validateContainerNumber(raw);
    if (!iso.valid || !iso.ownerCode) {
      return { ok: false, summary: "", error: "Carrier lookup requires a valid container number" };
    }
    const carrier = carrierForOwnerCode(iso.ownerCode);
    const lessorOwned = isLessorOwnerCode(iso.ownerCode);
    return {
      ok: true,
      summary: carrier
        ? `Owner code ${iso.ownerCode} maps to ${carrier.name}.`
        : lessorOwned
          ? `Owner code ${iso.ownerCode} belongs to a leasing company; the operating carrier is unknown.`
          : `Owner code ${iso.ownerCode} is not in the carrier directory.`,
      data: { owner_code: iso.ownerCode, lessor_owned: lessorOwned, carrier },
    };
  },
};
