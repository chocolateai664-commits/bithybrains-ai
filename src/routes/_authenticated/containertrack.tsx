import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReportHistory } from "@/applications/containertrack/components/ReportHistory";
import { TrackingForm } from "@/applications/containertrack/components/TrackingForm";
import { TrackingCard } from "@/components/reports/TrackingCard";
import type { ContainerReportRow, TrackingOutcome } from "@/applications/containertrack/types";
import { getContainerTrackDashboard, startCreditPurchase, trackContainer } from "@/lib/containertrack.functions";

export const Route = createFileRoute("/_authenticated/containertrack")({
  head: () => ({
    meta: [
      { title: "ContainerTrack · Container tracking reports" },
      {
        name: "description",
        content:
          "Track shipping containers, verify carrier and status against real sources, and generate printable tracking reports.",
      },
      { property: "og:title", content: "ContainerTrack · Container tracking reports" },
      { property: "og:description", content: "Verified container tracking reports with printable, QR-verifiable documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContainerTrackPage,
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="label-mono">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function ContainerTrackPage() {
  const queryClient = useQueryClient();
  const dashboardFn = useServerFn(getContainerTrackDashboard);
  const trackFn = useServerFn(trackContainer);
  const purchaseFn = useServerFn(startCreditPurchase);

  const dashboard = useQuery({ queryKey: ["containertrack-dashboard"], queryFn: () => dashboardFn({}) });
  const [outcome, setOutcome] = useState<TrackingOutcome | null>(null);
  const [selected, setSelected] = useState<ContainerReportRow | null>(null);

  const tracking = useMutation({
    mutationFn: (containerNumber: string) => trackFn({ data: { containerNumber } }),
    onSuccess: (result) => {
      setOutcome(result);
      setSelected(null);
      if (result.ok) toast.success(`Report ${result.report?.report_id} generated.`);
      else toast.error(result.message ?? "Tracking could not be completed.");
      void queryClient.invalidateQueries({ queryKey: ["containertrack-dashboard"] });
    },
    onError: () => toast.error("Tracking could not be completed."),
  });

  const purchase = useMutation({
    mutationFn: (planCode: string) =>
      purchaseFn({ data: { planCode, returnUrl: `${window.location.origin}/containertrack` } }),
    onSuccess: (result) => {
      if (result.ok && result.authorizationUrl) window.location.href = result.authorizationUrl;
      else toast.error(result.message ?? "Payment could not be started.");
    },
    onError: () => toast.error("Payment could not be started."),
  });

  const data = dashboard.data;
  const credits = data?.credits ?? { freeCredits: 0, paidCredits: 0, totalUsed: 0 };
  const shownReport = selected ?? outcome?.report ?? null;

  return (
    <div className="relative min-h-screen bg-background">
      <div className="grid-backdrop pointer-events-none absolute inset-0 print:hidden" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <p className="label-mono">Application</p>
            <h1 className="text-2xl font-semibold tracking-tight">ContainerTrack</h1>
            <p className="text-sm text-muted-foreground">Powered by Bithy Brains orchestration.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/console">Control center</Link>
          </Button>
        </header>

        {data && !data.status.providerConfigured && !data.status.developmentFixtures ? (
          <p className="mt-6 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm print:hidden">
            No live tracking source is configured yet, so tracking will return an unverified result and no credit will be
            used.
          </p>
        ) : null}
        {data?.status.developmentFixtures ? (
          <p className="mt-6 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] print:hidden">
            Development data — not live tracking
          </p>
        ) : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-3 print:hidden">
          <Stat label="Free credits" value={credits.freeCredits} />
          <Stat label="Paid credits" value={credits.paidCredits} />
          <Stat label="Reports generated" value={credits.totalUsed} />
        </section>

        <section className="mt-6 rounded-md border border-border bg-card p-5 print:hidden">
          <TrackingForm
            onTrack={(value) => tracking.mutate(value)}
            pending={tracking.isPending}
            creditsRemaining={credits.freeCredits + credits.paidCredits}
          />
          {outcome && !outcome.ok ? (
            <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
              <Badge variant="destructive">{outcome.code}</Badge>
              <p className="mt-2">{outcome.message}</p>
              {outcome.conflicts?.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                  {outcome.conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {shownReport || outcome?.result ? (
          <section className="mt-6">
            <div className="mb-3 flex justify-end gap-2 print:hidden">
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                Print / Save as PDF
              </Button>
            </div>
            <TrackingCard
              report={shownReport ?? undefined}
              result={shownReport ? undefined : outcome?.result}
              developmentData={outcome?.developmentData ?? false}
            />
          </section>
        ) : null}

        <section className="mt-8 print:hidden">
          <h2 className="mb-3 text-lg font-semibold">Recent reports</h2>
          <ReportHistory
            reports={data?.reports ?? []}
            onView={(report) => {
              setSelected(report);
              setOutcome(null);
            }}
            onPrint={(report) => {
              setSelected(report);
              setOutcome(null);
              setTimeout(() => window.print(), 120);
            }}
          />
        </section>

        <section className="mt-8 print:hidden">
          <h2 className="mb-3 text-lg font-semibold">Buy credits</h2>
          {!data?.status.paymentsConfigured ? (
            <p className="mb-3 text-sm text-muted-foreground">
              Card payments are not switched on yet, so these packages cannot be bought.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.plans ?? []).map((plan) => (
              <div key={plan.code} className="rounded-md border border-border bg-card p-4">
                <p className="font-medium">{plan.name}</p>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
                <p className="mt-2 text-lg font-semibold">
                  {plan.currency === "NGN" ? "₦" : ""}
                  {plan.amount.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {plan.credits} credit{plan.credits === 1 ? "" : "s"}
                </p>
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  disabled={!data?.status.paymentsConfigured || purchase.isPending}
                  onClick={() => purchase.mutate(plan.code)}
                >
                  Buy
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
