import qrcode from "qrcode-generator";
import { useMemo } from "react";
import type { ContainerReportRow, TrackingResult } from "@/applications/containertrack/types";

/**
 * Printable ContainerTrack tracking document (A4). Layout is real markup, not a
 * screenshot, so the browser's "Save as PDF" produces a vector document.
 */

export interface TrackingCardProps {
  report?: ContainerReportRow | undefined;
  result?: TrackingResult | undefined;
  verifyUrl?: string | undefined;
  developmentData?: boolean;
}

function qrDataUrl(value: string): string {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createDataURL(4, 0);
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="border-b border-border/60 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value && value.trim() ? value : "—"}</p>
    </div>
  );
}

export function TrackingCard({ report, result, verifyUrl, developmentData }: TrackingCardProps) {
  const data = report ?? result;
  if (!data) return null;

  const verified = data.verified;
  const reportId = report?.report_id ?? null;
  const generated = report?.created_at ? new Date(report.created_at) : new Date();
  const url = verifyUrl ?? (reportId ? `${typeof window !== "undefined" ? window.location.origin : ""}/verify/${reportId}` : "");
  const qr = useMemo(() => (url ? qrDataUrl(url) : null), [url]);

  return (
    <article className="tracking-card mx-auto w-full max-w-[820px] rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
      {developmentData ? (
        <p className="mb-4 rounded border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
          Development data — not live tracking
        </p>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">ContainerTrack</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Container Tracking Report</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{reportId ?? "Report not issued"}</p>
        </div>
        <div className="text-right">
          <span
            className={
              verified
                ? "inline-block rounded border border-emerald-600/60 bg-emerald-600/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400"
                : "inline-block rounded border border-destructive/60 bg-destructive/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-destructive"
            }
          >
            {verified ? "Verified" : "Unverified"}
          </span>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Generated {generated.toISOString().replace("T", " ").slice(0, 19)} UTC
          </p>
        </div>
      </header>

      <section className="mt-5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <Field label="Container number" value={data.container_number} />
        <Field label="Carrier" value={data.carrier} />
        <Field label="Status" value={data.status.replace(/_/g, " ")} />
        <Field label="Current location" value={data.current_location} />
        <Field label="Origin" value={data.origin} />
        <Field label="Destination" value={data.destination} />
        <Field label="Vessel" value={data.vessel} />
        <Field label="Voyage" value={data.voyage} />
        <Field label="Last event" value={data.last_event} />
        <Field label="Last event date" value={data.last_event_date} />
        <Field label="Estimated arrival" value={data.estimated_arrival} />
        <Field label="Confidence" value={`${Math.round(Number(data.confidence) * 100)}%`} />
        <Field label="Tracking source" value={data.tracking_source} />
        <Field label="Source retrieved" value={data.source_timestamp} />
      </section>

      <footer className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-5">
        <div className="max-w-[60%]">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Verification</p>
          <p className="mt-1 break-all text-xs">{url || "Available once a report is issued."}</p>
          {!verified ? (
            <p className="mt-2 text-xs text-destructive">
              This report is unverified. No tracking source confirmed these details.
            </p>
          ) : null}
          {data.source_url ? (
            <p className="mt-2 break-all text-[11px] text-muted-foreground">Source: {data.source_url}</p>
          ) : null}
        </div>
        {qr ? <img src={qr} alt={`QR code linking to ${url}`} className="h-24 w-24" /> : null}
      </footer>
    </article>
  );
}
