/**
 * Operational data redaction.
 *
 * Connector endpoints are administrative configuration: a signed-in user does
 * not need them, and exposing them widens the SSRF/recon surface. Redaction is
 * applied server-side, never in the UI.
 */

export interface RedactableApplication {
  api_endpoint?: string | null;
  [key: string]: unknown;
}

export function redactApplications<T extends RedactableApplication>(apps: T[], isAdmin: boolean): T[] {
  if (isAdmin) return apps;
  return apps.map((app) => ({ ...app, api_endpoint: app.api_endpoint ? "configured" : null }));
}
