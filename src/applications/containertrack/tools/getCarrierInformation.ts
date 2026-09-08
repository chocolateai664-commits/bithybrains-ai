import type { BithyTool } from "@/lib/brains/types";
import { carrierByCode, carrierForOwnerCode } from "../carriers";

export const getCarrierInformationTool: BithyTool = {
  id: "getCarrierInformation",
  name: "Get Carrier Information",
  description: "Return reference details (name, SCAC, official tracking page) for an identified carrier.",
  parameters: {
    type: "object",
    properties: { carrier: { type: "string" }, owner_code: { type: "string" } },
    output: { carrier: "object|null" },
  },
  permissions: ["containertrack:read"],
  destructive: false,
  execute: async (ctx) => {
    const code = String(ctx.params?.["carrier"] ?? "");
    const ownerCode = String(ctx.params?.["owner_code"] ?? "");
    const carrier = (code ? carrierByCode(code) : null) ?? (ownerCode ? carrierForOwnerCode(ownerCode) : null);
    if (!carrier) return { ok: false, summary: "", error: "Carrier is not in the directory" };
    return {
      ok: true,
      summary: `${carrier.name} (${carrier.scac}) — official tracking: ${carrier.trackingPage}`,
      data: { carrier },
    };
  },
};
