export const METRIC_CSV_MAX_BYTES = 256 * 1024;
export const METRIC_CSV_MAX_ROWS = 10_000;

export type MetricCsvObservation = { date: string; value: number };

export type MetricCsvParseResult =
  | {
      ok: true;
      observations: MetricCsvObservation[];
      summary: { acceptedRows: number; rejectedRows: 0; startDate: string; endDate: string };
    }
  | {
      ok: false;
      code: "empty" | "too_large" | "encoding" | "header" | "row_limit" | "row";
      error: string;
      acceptedRows: number;
      rejectedRows: number;
      details: string[];
    };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month - 1
    && normalized.getUTCDate() === day;
}

function failure(
  code: Extract<MetricCsvParseResult, { ok: false }>["code"],
  error: string,
  acceptedRows = 0,
  rejectedRows = 0,
  details: string[] = [],
): MetricCsvParseResult {
  return { ok: false, code, error, acceptedRows, rejectedRows, details };
}

/**
 * Strict daily metric CSV parser. The accepted dialect is deliberately small:
 * UTF-8 text, exact `date,value` header, and two unquoted fields per row.
 * Rejecting quoted/multiline cells avoids ambiguous spreadsheet interpretation.
 */
export function parseMetricCsv(bytes: Uint8Array): MetricCsvParseResult {
  if (bytes.byteLength === 0) return failure("empty", "Choose a non-empty CSV file.");
  if (bytes.byteLength > METRIC_CSV_MAX_BYTES) {
    return failure("too_large", `CSV files must be ${METRIC_CSV_MAX_BYTES / 1024} KB or smaller.`);
  }
  if (bytes.some((byte) => byte === 0)) {
    return failure("encoding", "The file contains binary data. Save it as UTF-8 CSV and try again.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("encoding", "The file is not valid UTF-8. Export it as UTF-8 CSV and try again.");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\r") && !text.includes("\r\n")) {
    return failure("encoding", "Unsupported line endings. Export the file with standard LF or CRLF rows.");
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return failure("empty", "Choose a non-empty CSV file.");
  if (lines[0] !== "date,value") {
    return failure("header", "The first row must be exactly `date,value` (in that order).", 0, 1, [
      `Found: ${lines[0].slice(0, 80) || "(blank)"}`,
    ]);
  }
  const dataLines = lines.slice(1);
  if (dataLines.length === 0) return failure("empty", "Add at least one daily observation below `date,value`.");
  if (dataLines.length > METRIC_CSV_MAX_ROWS) {
    return failure("row_limit", `CSV files may contain at most ${METRIC_CSV_MAX_ROWS.toLocaleString("en-US")} observations.`, 0, dataLines.length);
  }

  const observations: MetricCsvObservation[] = [];
  const seenDates = new Set<string>();
  const errors: string[] = [];
  let rejectedRows = 0;
  for (let index = 0; index < dataLines.length; index += 1) {
    const lineNumber = index + 2;
    const line = dataLines[index];
    if (line.includes('"')) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: quoted or multiline fields are not supported.`);
      continue;
    }
    const fields = line.split(",");
    if (fields.length !== 2 || fields.some((field) => field !== field.trim())) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: expected exactly two unpadded fields: YYYY-MM-DD,value.`);
      continue;
    }
    const [date, rawValue] = fields;
    if (!validDate(date)) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: ${date || "(blank)"} is not a valid YYYY-MM-DD calendar date.`);
      continue;
    }
    if (seenDates.has(date)) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: duplicate date ${date}; each daily date must appear once.`);
      continue;
    }
    if (!NUMBER_PATTERN.test(rawValue)) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: ${rawValue || "(blank)"} is not a plain finite number.`);
      continue;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      rejectedRows += 1;
      errors.push(`Row ${lineNumber}: value must be finite and no larger than 1e15 in magnitude.`);
      continue;
    }
    seenDates.add(date);
    observations.push({ date, value });
  }

  if (rejectedRows > 0) {
    return failure(
      "row",
      `Import stopped: ${rejectedRows} invalid row${rejectedRows === 1 ? "" : "s"}. No observations were written.`,
      observations.length,
      rejectedRows,
      errors.slice(0, 8),
    );
  }
  observations.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ok: true,
    observations,
    summary: {
      acceptedRows: observations.length,
      rejectedRows: 0,
      startDate: observations[0].date,
      endDate: observations.at(-1)!.date,
    },
  };
}
