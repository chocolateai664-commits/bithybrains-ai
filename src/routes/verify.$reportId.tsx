import { createFileRoute } from "@tanstack/react-router";
import { verifyReport } from "@/lib/containertrack.functions";

/** Public verification page. Exposes only non-sensitive report fields. */
export const Route = createFileRoute("/verify/$reportId")({
  loader: ({ params }) => verifyReport({ data: { reportId: params.reportId } }),
  head: ({ params }) => ({
    meta: [
      { title: `Verify report ${params.reportId} · ContainerTrack` },
      { name: "description", content: `Check whether ContainerTrack report ${params.reportId} is genuine and verified.` },
      { property: "og:title", content: `Verify report ${params.reportId} · ContainerTrack` },
      { property: "og:description", content: "Public verification of a ContainerTrack container tracking report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: () => <Shell>This verification page could not be loaded.</Shell>,
  notFoundComponent: () => <Shell>No report matches this code.</Shell>,
  component: VerifyPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
      <p className="label-mono">ContainerTrack</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Report verification</h1>
      <div className="mt-6 rounded-md border border-border bg-card p-6 text-sm">{children}</div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function VerifyPage() {
  const report = Route.useLoaderData();
  if (!report) return <Shell>No report matches this code.</Shell>;

  return (
    <Shell>
      <div
        className={
          report.verified
            ? "mb-4 rounded border border-emerald-600/60 bg-emerald-600/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400"
            : "mb-4 rounded border border-destructive/60 bg-destructive/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.2em] text-destructive"
        }
      >
        {report.verified ? "Verified: yes" : "Verified: no"}
      </div>
      <Row label="Report" value={report.reportId} />
      <Row label="Container" value={report.containerNumber} />
      <Row label="Status" value={report.status.replace(/_/g, " ")} />
      <Row label="Carrier" value={report.carrier ?? "—"} />
      <Row label="Current location" value={report.currentLocation ?? "—"} />
      <Row label="Source" value={report.trackingSource ?? "—"} />
      <Row label="Last updated" value={report.sourceTimestamp ?? "—"} />
      <Row label="Generated" value={new Date(report.generatedAt).toUTCString()} />
    </Shell>
  );
}
