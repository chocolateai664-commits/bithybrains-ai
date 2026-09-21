import { describe, expect, it } from "vitest";
import { computeCheckDigit, normalizeContainerNumber, validateContainerNumber } from "../src/lib/iso6346";
import { generateReportId } from "../src/applications/containertrack/services/reportService.server";
import { TrackingResultSchema } from "../src/applications/containertrack/types";
import { carrierForOwnerCode } from "../src/applications/containertrack/carriers";

/** Deterministic container-number validation and report contracts. */

function withCheckDigit(first10: string): string {
  return `${first10}${computeCheckDigit(first10)}`;
}

describe("ISO 6346 validation", () => {
  it("accepts numbers with a correct check digit", () => {
    for (const first10 of ["MSCU123456", "MAEU000000", "HLCU987654", "CMAU555555"]) {
      const number = withCheckDigit(first10);
      expect(validateContainerNumber(number).valid).toBe(true);
    }
  });

  it("rejects an incorrect check digit", () => {
    const number = withCheckDigit("MSCU123456");
    const wrong = `${number.slice(0, 10)}${(Number(number[10]) + 1) % 10}`;
    const result = validateContainerNumber(wrong);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("check_digit");
  });

  it("rejects the wrong length", () => {
    expect(validateContainerNumber("MSCU12345").reason).toBe("length");
    expect(validateContainerNumber("MSCU12345678").reason).toBe("length");
  });

  it("rejects malformed input", () => {
    expect(validateContainerNumber("").reason).toBe("empty");
    expect(validateContainerNumber("MS1U1234567").reason).toBe("format");
    expect(validateContainerNumber("MSCX1234567").reason).toBe("category");
  });

  it("normalizes separators and casing", () => {
    expect(normalizeContainerNumber(" mscu 123456-7 ")).toBe("MSCU1234567");
  });

  it("resolves the carrier deterministically from the owner code", () => {
    expect(carrierForOwnerCode("MSC")?.code).toBe("MSC");
    expect(carrierForOwnerCode("ZZZ")).toBeNull();
  });
});

describe("report contracts", () => {
  it("issues report ids in the CTR-YYYY-XXXXXX format", () => {
    const id = generateReportId(new Date("2026-05-01T00:00:00Z"));
    expect(id).toMatch(/^CTR-2026-[A-Z0-9]{6}$/);
  });

  it("rejects model output with an unknown status", () => {
    const result = TrackingResultSchema.safeParse({
      container_number: "MSCU1234565",
      carrier: "MSC",
      status: "ON_THE_MOON",
      current_location: null,
      origin: null,
      destination: null,
      vessel: null,
      voyage: null,
      last_event: null,
      last_event_date: null,
      estimated_arrival: null,
      tracking_source: null,
      source_url: null,
      source_timestamp: null,
      confidence: 0.5,
      verified: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hallucinated source url that is not a url", () => {
    const base = {
      container_number: "MSCU1234565",
      carrier: "MSC",
      status: "IN_TRANSIT",
      current_location: "Lagos",
      origin: null,
      destination: null,
      vessel: null,
      voyage: null,
      last_event: null,
      last_event_date: null,
      estimated_arrival: null,
      tracking_source: "provider",
      source_timestamp: "2026-09-07T10:00:00Z",
      confidence: 0.9,
      verified: true,
    };
    expect(TrackingResultSchema.safeParse({ ...base, source_url: "not a url" }).success).toBe(false);
    expect(TrackingResultSchema.safeParse({ ...base, source_url: "https://example.com" }).success).toBe(true);
  });

  it("rejects an out-of-range confidence", () => {
    const result = TrackingResultSchema.safeParse({
      container_number: "MSCU1234565",
      carrier: null,
      status: "UNVERIFIED",
      current_location: null,
      origin: null,
      destination: null,
      vessel: null,
      voyage: null,
      last_event: null,
      last_event_date: null,
      estimated_arrival: null,
      tracking_source: null,
      source_url: null,
      source_timestamp: null,
      confidence: 4,
      verified: false,
    });
    expect(result.success).toBe(false);
  });
});
