/**
 * CSV serialization shared by the audit export server function and the console.
 * Values are quoted and formula-injection is neutralised.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  text = text.replace(/\r\n|\r|\n/g, " ");
  // Excel/Sheets treat leading =,+,-,@ as formulas; prefix with a single quote.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return "";
  const headers = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  return lines.join("\n");
}
