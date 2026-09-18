import "server-only";

/**
 * CSV export (docs/ADMIN.md §2, §55 of the source specification).
 *
 * Two things this gets right that a join-with-commas does not.
 *
 * Every field is quoted and every quote inside is doubled. Emails do not contain
 * commas, until the day one does and the file silently shifts a column.
 *
 * And a field that begins with =, +, - or @ is prefixed with a single quote.
 * Excel treats such a cell as a formula, which is a real way a spreadsheet of
 * user-supplied text becomes a way to run something on the machine that opens
 * it. The prefix is visible and harmless; the alternative is not.
 */

function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  // CRLF and a BOM: Excel opens UTF-8 without a BOM as Latin-1, which turns
  // every Devanagari name in the export into mojibake.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** A download response. The filename carries the date so files do not overwrite. */
export function csvResponse(name: string, body: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
