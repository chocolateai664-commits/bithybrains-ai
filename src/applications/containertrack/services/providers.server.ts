import { OutboundUrlError, safeFetch } from "@/lib/brains/net.server";
import { isApprovedSourceHost } from "../config";
import type { TrackingSource } from "../types";

/**
 * Controlled outbound access for ContainerTrack.
 *
 * The model NEVER supplies a URL and never gets network access. Only the two
 * functions below reach the network, both through the SSRF-guarded `safeFetch`
 * and only against operator-configured or explicitly approved hosts.
 */

export class ProviderUnavailable extends Error {}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export interface ProviderConfig {
  name: string;
  urlTemplate: string;
  apiKey?: string | undefined;
  authHeader: string;
}

export function providerConfig(): ProviderConfig | null {
  const urlTemplate = env("TRACKING_PROVIDER_URL");
  if (!urlTemplate || !urlTemplate.includes("{container}")) return null;
  return {
    name: env("TRACKING_PROVIDER_NAME") ?? "tracking-provider",
    urlTemplate,
    apiKey: env("TRACKING_API_KEY"),
    authHeader: env("TRACKING_API_KEY_HEADER") ?? "authorization",
  };
}

export function searchConfigured(): boolean {
  return !!env("CONTAINERTRACK_SEARCH_URL");
}

export function developmentFixturesEnabled(): boolean {
  return process.env["NODE_ENV"] !== "production" && env("CONTAINERTRACK_DEV_FIXTURES") === "true";
}

function extraApprovedHosts(): string[] {
  return (env("CONTAINERTRACK_APPROVED_DOMAINS") ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function assertApproved(url: string): URL {
  const parsed = new URL(url);
  if (!isApprovedSourceHost(parsed.hostname, extraApprovedHosts())) {
    throw new OutboundUrlError(`Host ${parsed.hostname} is not an approved ContainerTrack source`);
  }
  return parsed;
}

/** Queries the configured commercial tracking provider. */
export async function fetchProviderTracking(containerNumber: string): Promise<TrackingSource> {
  const config = providerConfig();
  if (!config) throw new ProviderUnavailable("No tracking provider is configured");

  const url = config.urlTemplate.replace("{container}", encodeURIComponent(containerNumber));
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) {
    headers[config.authHeader] =
      config.authHeader.toLowerCase() === "authorization" ? `Bearer ${config.apiKey}` : config.apiKey;
  }

  const response = await safeFetch(url, { headers });
  if (response.status < 200 || response.status >= 300) {
    throw new ProviderUnavailable(`Tracking provider returned status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new ProviderUnavailable("Tracking provider returned a non-JSON response");
  }

  return {
    kind: "provider",
    name: config.name,
    url: new URL(url).origin,
    retrievedAt: new Date().toISOString(),
    payload,
  };
}

/**
 * Fallback lookup against an operator-configured search source. Results are
 * untrusted text: they are only ever passed to the model as data.
 */
export async function searchContainerSources(containerNumber: string): Promise<TrackingSource | null> {
  const searchUrl = env("CONTAINERTRACK_SEARCH_URL");
  if (!searchUrl) return null;

  const url = searchUrl.includes("{container}")
    ? searchUrl.replace("{container}", encodeURIComponent(containerNumber))
    : `${searchUrl}${searchUrl.includes("?") ? "&" : "?"}q=${encodeURIComponent(`${containerNumber} container tracking`)}`;

  const headers: Record<string, string> = { accept: "application/json" };
  const key = env("CONTAINERTRACK_SEARCH_API_KEY");
  if (key) headers["authorization"] = `Bearer ${key}`;

  try {
    const response = await safeFetch(url, { headers });
    if (response.status < 200 || response.status >= 300) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = response.body.slice(0, 4_000);
    }
    return {
      kind: "web",
      name: "approved-web-search",
      url: new URL(url).origin,
      retrievedAt: new Date().toISOString(),
      payload,
    };
  } catch {
    return null;
  }
}

/** Fetches a single approved carrier page (never a model-supplied URL). */
export async function fetchApprovedPage(url: string): Promise<string | null> {
  try {
    const parsed = assertApproved(url);
    const response = await safeFetch(parsed.toString(), { headers: { accept: "text/html,application/json" } });
    if (response.status < 200 || response.status >= 300) return null;
    return response.body.slice(0, 4_000);
  } catch {
    return null;
  }
}

/** Clearly-labelled development-only data. Never available in production. */
export function developmentTrackingSource(containerNumber: string, carrier: string | null): TrackingSource {
  return {
    kind: "development",
    name: "DEVELOPMENT DATA — NOT LIVE TRACKING",
    url: null,
    retrievedAt: new Date().toISOString(),
    payload: {
      notice: "DEVELOPMENT DATA — NOT LIVE TRACKING",
      container_number: containerNumber,
      carrier,
      status: "IN_TRANSIT",
      current_location: "Lagos",
      origin: "Shanghai",
      destination: "Lagos",
      vessel: "Example Vessel",
      voyage: "123A",
      last_event: "Discharged",
      last_event_date: new Date().toISOString().slice(0, 10),
      estimated_arrival: null,
    },
  };
}
