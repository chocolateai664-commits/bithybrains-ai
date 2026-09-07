/**
 * Deterministic ISO 6346 container-number validation.
 *
 * This is application logic, never an AI judgement: an LLM must not decide
 * whether a container number is valid. Invalid numbers stop the tracking
 * pipeline before any external request is made.
 */

/** ISO 6346 letter values. Multiples of 11 (11, 22, 33) are skipped. */
const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

/** Equipment category identifiers defined by the standard. */
export const CATEGORY_IDENTIFIERS = ["U", "J", "Z"] as const;
export type CategoryIdentifier = (typeof CATEGORY_IDENTIFIERS)[number];

export type Iso6346Reason =
  | "empty"
  | "length"
  | "format"
  | "owner_code"
  | "category"
  | "serial"
  | "check_digit";

export interface Iso6346Result {
  valid: boolean;
  normalized: string;
  ownerCode?: string;
  categoryIdentifier?: string;
  serial?: string;
  checkDigit?: number;
  expectedCheckDigit?: number;
  reason?: Iso6346Reason;
  message?: string;
}

/** Uppercases and strips separators/whitespace so "mscu 123456-7" is accepted. */
export function normalizeContainerNumber(input: string): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Computes the ISO 6346 check digit for the first 10 characters. */
export function computeCheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = first10[i]!;
    const value = /[0-9]/.test(char) ? Number(char) : LETTER_VALUES[char];
    if (value === undefined) return NaN;
    sum += value * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function validateContainerNumber(input: string): Iso6346Result {
  const normalized = normalizeContainerNumber(input);
  if (!normalized) {
    return { valid: false, normalized, reason: "empty", message: "No container number supplied." };
  }
  if (normalized.length !== 11) {
    return {
      valid: false,
      normalized,
      reason: "length",
      message: "A container number must be exactly 11 characters (4 letters and 7 digits).",
    };
  }
  if (!/^[A-Z]{4}[0-9]{7}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: "format",
      message: "Expected 4 letters followed by 7 digits, for example MSCU1234567.",
    };
  }

  const ownerCode = normalized.slice(0, 3);
  const categoryIdentifier = normalized.slice(3, 4);
  const serial = normalized.slice(4, 10);
  const checkDigit = Number(normalized.slice(10, 11));

  if (!/^[A-Z]{3}$/.test(ownerCode) || ownerCode.split("").some((c) => LETTER_VALUES[c] === undefined)) {
    return { valid: false, normalized, reason: "owner_code", message: "The 3-letter owner code is not valid." };
  }
  if (!(CATEGORY_IDENTIFIERS as readonly string[]).includes(categoryIdentifier)) {
    return {
      valid: false,
      normalized,
      ownerCode,
      categoryIdentifier,
      reason: "category",
      message: "The 4th character must be an equipment category identifier (U, J or Z).",
    };
  }
  if (!/^[0-9]{6}$/.test(serial)) {
    return { valid: false, normalized, ownerCode, categoryIdentifier, reason: "serial", message: "Invalid serial number." };
  }

  const expected = computeCheckDigit(normalized.slice(0, 10));
  if (Number.isNaN(expected) || expected !== checkDigit) {
    return {
      valid: false,
      normalized,
      ownerCode,
      categoryIdentifier,
      serial,
      checkDigit,
      expectedCheckDigit: Number.isNaN(expected) ? undefined : expected,
      reason: "check_digit",
      message: "The check digit does not match the container number.",
    };
  }

  return {
    valid: true,
    normalized,
    ownerCode,
    categoryIdentifier,
    serial,
    checkDigit,
    expectedCheckDigit: expected,
  };
}
