import { OUTBOUND } from "./config.server";

/**
 * SSRF-safe outbound requests.
 *
 * Every request Bithy Brains makes to a URL that came from the database, a user
 * or an application registry entry MUST go through `safeFetch`. Direct `fetch`
 * on such URLs is a security bug.
 */

export class OutboundUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4Blocked(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6Blocked(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80") || h.startsWith("fec0")) return true; // link/site-local
  if (/^f[cd]/.test(h)) return true; // unique local
  if (h.startsWith("::ffff:")) return true; // IPv4-mapped
  return false;
}

/**
 * Validates a connector URL. Returns the parsed URL or throws `OutboundUrlError`
 * with a message that is safe to surface to a console operator.
 */
export function validateOutboundUrl(raw: string, options: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError("Endpoint is not a valid URL");
  }

  const allowHttp = options.allowHttp ?? process.env["NODE_ENV"] !== "production";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new OutboundUrlError("Endpoint must use HTTPS");
  }
  if (url.username || url.password) {
    throw new OutboundUrlError("Endpoint must not embed credentials");
  }
  if (url.port && !["", "80", "443", "8080", "8443"].includes(url.port)) {
    throw new OutboundUrlError("Endpoint port is not permitted");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new OutboundUrlError("Endpoint has no hostname");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new OutboundUrlError("Endpoint resolves to a blocked internal host");
  }
  if (isIpv4(host)) {
    if (ipv4Blocked(host)) throw new OutboundUrlError("Endpoint resolves to a private or reserved address");
  } else if (host.includes(":") || url.hostname.startsWith("[")) {
    if (ipv6Blocked(host)) throw new OutboundUrlError("Endpoint resolves to a private or reserved address");
  } else if (!host.includes(".")) {
    throw new OutboundUrlError("Endpoint hostname must be fully qualified");
  }

  return url;
}

export interface SafeFetchResult {
  status: number;
  body: string;
  truncated: boolean;
}

/**
 * Fetches an external endpoint with SSRF validation, manual redirect handling,
 * a hard timeout and a response-size cap. Internal network responses can never
 * be returned because every hop is re-validated before it is followed.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  options: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? OUTBOUND.maxBytes;
  const timeoutMs = options.timeoutMs ?? OUTBOUND.timeoutMs;
  const maxRedirects = options.maxRedirects ?? OUTBOUND.maxRedirects;

  let target = validateOutboundUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const res = await fetch(target.toString(), {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) throw new OutboundUrlError("Endpoint returned a redirect without a target");
        if (hop === maxRedirects) throw new OutboundUrlError("Endpoint exceeded the redirect limit");
        // Re-validate every hop: this is what stops redirect-based SSRF.
        target = validateOutboundUrl(new URL(location, target).toString());
        continue;
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new OutboundUrlError("Endpoint response is too large");

      const text = await readCapped(res, maxBytes);
      return { status: res.status, body: text.body, truncated: text.truncated };
    }
    throw new OutboundUrlError("Endpoint exceeded the redirect limit");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { body: "", truncated: false };

  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      out += decoder.decode(value.slice(0, Math.max(0, maxBytes - (size - value.byteLength))));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  return { body: out, truncated };
}
