import { createFileRoute } from "@tanstack/react-router";
import {
  applyPaymentCredits,
  verifyTransaction,
  verifyWebhookSignature,
} from "@/applications/containertrack/services/paymentService.server";

/**
 * Paystack webhook. The frontend callback is never proof of payment: the
 * signature is verified, the transaction is re-checked with Paystack, and the
 * credit grant is idempotent per (provider, reference).
 */
export const Route = createFileRoute("/api/public/payments/paystack-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 64 * 1024) return new Response("Payload too large", { status: 413 });

        if (!verifyWebhookSignature(raw, request.headers.get("x-paystack-signature"))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: { event?: string; data?: { reference?: string } };
        try {
          event = JSON.parse(raw) as typeof event;
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        if (event.event !== "charge.success" || !event.data?.reference) {
          return new Response("ignored", { status: 200 });
        }

        const verified = await verifyTransaction(event.data.reference);
        if (!verified.ok || !verified.userId || !verified.credits) {
          return new Response("unverified", { status: 202 });
        }

        await applyPaymentCredits({
          reference: event.data.reference,
          userId: verified.userId,
          credits: verified.credits,
          amount: verified.amount,
          currency: verified.currency,
          planCode: verified.planCode ?? null,
        });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
