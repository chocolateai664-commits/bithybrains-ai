/**
 * ContainerTrack application configuration.
 *
 * Bithy Brains stays application-agnostic: everything ContainerTrack-specific
 * (capabilities, tools, billing policy, caching, approved sources) is declared
 * here and read by the shared orchestration layer.
 */

export const CONTAINERTRACK = {
  slug: "containertrack",
  name: "ContainerTrack",
  description: "Container tracking, logistics verification and printable tracking reports.",
  capabilities: [
    "container_tracking",
    "container_validation",
    "carrier_lookup",
    "shipment_status",
    "logistics_search",
    "tracking_report_generation",
    "report_verification",
  ],
  tools: [
    "validateContainerNumber",
    "identifyCarrier",
    "trackContainer",
    "searchContainerWeb",
    "getCarrierInformation",
    "generateTrackingReport",
  ],
  /** Capabilities requested from the shared model router (never a hard-coded model). */
  modelCapabilities: ["container_tracking", "tool_use", "structured_output", "web_search", "reasoning"],
  /** Preferred provider for the MVP when the registry offers a choice. */
  preferredProvider: "google",
  billing: {
    creditsPerReport: 1,
    /** Unverified results are never billable. */
    chargeOnUnverified: false,
  },
  cache: {
    ttlMinutes: 15,
  },
  timeouts: {
    toolMs: 8_000,
  },
  reportIdPrefix: "CTR",
} as const;

/**
 * Approved outbound sources. The model can never supply a URL: tools may only
 * reach hosts on this list (plus the configured provider host), and every call
 * still goes through the SSRF-guarded `safeFetch`.
 */
export const APPROVED_SOURCE_DOMAINS = [
  "www.msc.com",
  "www.maersk.com",
  "www.hapag-lloyd.com",
  "elines.coscoshipping.com",
  "www.cma-cgm.com",
  "www.oocl.com",
  "www.evergreen-line.com",
  "ecomm.one-line.com",
  "www.zim.com",
] as const;

export function isApprovedSourceHost(host: string, extraHosts: string[] = []): boolean {
  const normalized = host.toLowerCase();
  return (APPROVED_SOURCE_DOMAINS as readonly string[]).includes(normalized) || extraHosts.includes(normalized);
}
