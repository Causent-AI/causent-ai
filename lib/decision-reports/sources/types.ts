export const INITIAL_PROMPT_SOURCE_ID = "initial-prompt";
export const REPORT_SOURCE_MAX_CHUNK_CHARS = 2_000;
export const REPORT_SOURCE_MAX_EXTRACTED_CHARS = 48_000;
export const REPORT_SOURCE_MAX_CORPUS_CHARS = 72_000;
export const REPORT_SOURCE_MAX_URL_BYTES = 1_048_576;
export const REPORT_SOURCE_MAX_PDF_BYTES = 5 * 1_048_576;
export const REPORT_SOURCE_MAX_PDF_PAGES = 40;

export type ReportSourceKind = "brief" | "url" | "pdf";

export type ReportSourceChunkSummary = {
  chunkId: string;
  locator: string | null;
  /** Digest and bounded text make the cited evidence independently auditable later. */
  contentSha256: string;
  text: string;
};

/**
 * RLS-protected provenance persisted with a v2 report snapshot. Original files,
 * response bytes, credentials, URL query strings, and fragments are never kept.
 */
export type ReportSourceSummary = {
  sourceId: string;
  chunks: ReportSourceChunkSummary[];
  kind: ReportSourceKind;
  label: string;
  locator: string | null;
  finalOrigin: string | null;
  pageCount: number | null;
  retrievedAt: string;
  contentSha256: string;
};

/** Source text stays bounded and server-owned until sanitized summaries are built. */
export type ReportSourceChunk = {
  chunkId: string;
  sourceId: string;
  kind: ReportSourceKind;
  label: string;
  locator: string | null;
  text: string;
};

export type ReportSourceCorpus = {
  brief: string;
  sources: ReportSourceSummary[];
  chunks: ReportSourceChunk[];
};

export type ExtractedReportSource = {
  kind: Exclude<ReportSourceKind, "brief">;
  label: string;
  locator: string | null;
  pageCount: number | null;
  sections: Array<{
    text: string;
    locator: string | null;
  }>;
};

export class ReportSourceInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReportSourceInputError";
    this.code = code;
  }
}

export function normalizedSourceText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
