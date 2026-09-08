import type { Db } from "@/lib/brains/db.server";
import { CONTAINERTRACK } from "../config";
import type { ContainerReportRow, TrackingResult } from "../types";

/** Report persistence and the public verification projection. */

const REPORT_COLUMNS =
  "id, report_id, container_number, carrier, status, current_location, origin, destination, vessel, voyage, last_event, last_event_date, estimated_arrival, tracking_source, source_url, source_timestamp, confidence, verified, created_at";

/** CTR-YYYY-XXXXXX */
export function generateReportId(now = new Date()): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${CONTAINERTRACK.reportIdPrefix}-${now.getUTCFullYear()}-${suffix}`;
}

export async function persistReport(
  admin: Db,
  input: { userId: string; requestId: string; result: TrackingResult; raw: unknown },
): Promise<ContainerReportRow> {
  const { result } = input;
  const reportId = generateReportId();
  const { data, error } = await admin
    .from("container_reports")
    .insert({
      report_id: reportId,
      user_id: input.userId,
      request_id: input.requestId,
      container_number: result.container_number,
      carrier: result.carrier,
      status: result.status,
      current_location: result.current_location,
      origin: result.origin,
      destination: result.destination,
      vessel: result.vessel,
      voyage: result.voyage,
      last_event: result.last_event,
      last_event_date: result.last_event_date,
      estimated_arrival: result.estimated_arrival,
      tracking_source: result.tracking_source,
      source_url: result.source_url,
      source_timestamp: result.source_timestamp,
      confidence: result.confidence,
      verified: result.verified,
      raw_json: input.raw as never,
    })
    .select(REPORT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as ContainerReportRow;
}

export async function listReports(db: Db, limit = 25): Promise<ContainerReportRow[]> {
  const { data, error } = await db
    .from("container_reports")
    .select(REPORT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContainerReportRow[];
}

export async function getOwnReport(db: Db, reportId: string): Promise<ContainerReportRow | null> {
  const { data } = await db.from("container_reports").select(REPORT_COLUMNS).eq("report_id", reportId).maybeSingle();
  return (data as ContainerReportRow | null) ?? null;
}

export interface PublicVerification {
  reportId: string;
  containerNumber: string;
  carrier: string | null;
  status: string;
  currentLocation: string | null;
  verified: boolean;
  trackingSource: string | null;
  sourceTimestamp: string | null;
  generatedAt: string;
}

/** Only non-sensitive fields; never user, payment or internal data. */
export async function getPublicVerification(admin: Db, reportId: string): Promise<PublicVerification | null> {
  const { data } = await admin
    .from("container_reports")
    .select(
      "report_id, container_number, carrier, status, current_location, verified, tracking_source, source_timestamp, created_at",
    )
    .eq("report_id", reportId)
    .maybeSingle();
  if (!data) return null;
  return {
    reportId: data.report_id,
    containerNumber: data.container_number,
    carrier: data.carrier,
    status: data.status,
    currentLocation: data.current_location,
    verified: data.verified,
    trackingSource: data.tracking_source,
    sourceTimestamp: data.source_timestamp,
    generatedAt: data.created_at,
  };
}
