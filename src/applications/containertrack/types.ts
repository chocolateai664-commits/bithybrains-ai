import { z } from "zod";

/** ContainerTrack contracts. The strict schema is the only accepted AI output. */

export const TRACKING_STATUSES = [
  "IN_TRANSIT",
  "AT_PORT",
  "LOADED",
  "DEPARTED",
  "ARRIVED",
  "DISCHARGED",
  "DELIVERED",
  "DELAYED",
  "UNVERIFIED",
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const CONTAINERTRACK_ERRORS = [
  "INVALID_CONTAINER",
  "NO_CREDITS",
  "TRACKING_UNAVAILABLE",
  "PROVIDER_ERROR",
  "SOURCE_CONFLICT",
  "UNVERIFIED",
  "AI_ERROR",
  "PAYMENT_ERROR",
  "RATE_LIMITED",
] as const;

export type ContainerTrackErrorCode = (typeof CONTAINERTRACK_ERRORS)[number];

const nullableString = z.string().trim().min(1).max(200).nullable();

/** Strict output schema — raw model JSON is never trusted without this. */
export const TrackingResultSchema = z.object({
  container_number: z.string().regex(/^[A-Z]{4}[0-9]{7}$/),
  carrier: nullableString,
  status: z.enum(TRACKING_STATUSES),
  current_location: nullableString,
  origin: nullableString,
  destination: nullableString,
  vessel: nullableString,
  voyage: nullableString,
  last_event: nullableString,
  last_event_date: z.string().trim().max(40).nullable(),
  estimated_arrival: z.string().trim().max(40).nullable(),
  tracking_source: nullableString,
  source_url: z.string().trim().url().max(500).nullable(),
  source_timestamp: z.string().trim().max(60).nullable(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
});

export type TrackingResult = z.infer<typeof TrackingResultSchema>;

export interface TrackingSource {
  /** "provider", "web" or "development" */
  kind: "provider" | "web" | "development";
  name: string;
  url: string | null;
  retrievedAt: string;
  /** Untrusted payload as returned by the source. */
  payload: unknown;
}

export interface ContainerReportRow {
  id: string;
  report_id: string;
  container_number: string;
  carrier: string | null;
  status: string;
  current_location: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  voyage: string | null;
  last_event: string | null;
  last_event_date: string | null;
  estimated_arrival: string | null;
  tracking_source: string | null;
  source_url: string | null;
  source_timestamp: string | null;
  confidence: number;
  verified: boolean;
  created_at: string;
}

export interface TrackingOutcome {
  ok: boolean;
  code?: ContainerTrackErrorCode;
  message?: string;
  requestId: string;
  creditConsumed: boolean;
  cached: boolean;
  developmentData: boolean;
  conflicts?: string[];
  result?: TrackingResult;
  report?: ContainerReportRow;
}
