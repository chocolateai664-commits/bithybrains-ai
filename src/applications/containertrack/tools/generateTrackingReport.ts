import type { BithyTool } from "@/lib/brains/types";
import { CONTAINERTRACK } from "../config";
import { consumeCredit } from "../services/creditService.server";
import { persistReport } from "../services/reportService.server";
import { TrackingResultSchema } from "../types";

/**
 * The single billable step. It re-validates the structured result server-side,
 * consumes exactly one credit atomically, then persists the report. An
 * unverified result is never billed and never stored as a report.
 */
export const generateTrackingReportTool: BithyTool = {
  id: "generateTrackingReport",
  name: "Generate Tracking Report",
  description: "Persist a validated tracking result as a printable report and consume one credit.",
  parameters: {
    type: "object",
    properties: { result: { type: "object" } },
    required: ["result"],
    output: { report_id: "string", credit_consumed: "boolean" },
  },
  permissions: ["containertrack:write"],
  destructive: false,
  execute: async (ctx) => {
    const parsed = TrackingResultSchema.safeParse(ctx.params?.["result"]);
    if (!parsed.success) return { ok: false, summary: "", error: "Tracking result failed schema validation" };
    const result = parsed.data;

    if (!result.verified && !CONTAINERTRACK.billing.chargeOnUnverified) {
      return { ok: false, summary: "", error: "Unverified results are not billable and are not stored as reports" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const balance = await consumeCredit(supabaseAdmin, ctx.userId);
    if (!balance) return { ok: false, summary: "", error: "No tracking credits remaining" };

    try {
      const report = await persistReport(supabaseAdmin, {
        userId: ctx.userId,
        requestId: String(ctx.params?.["requestId"] ?? crypto.randomUUID()),
        result,
        raw: ctx.params?.["raw"] ?? {},
      });
      return {
        ok: true,
        summary: `Report ${report.report_id} generated for ${result.container_number}.`,
        data: { report, balance, credit_consumed: true },
      };
    } catch (error) {
      return {
        ok: false,
        summary: "",
        error: error instanceof Error ? error.message : "Report could not be stored",
      };
    }
  },
};
