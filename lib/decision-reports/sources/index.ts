import { createReportSourceCorpus } from "./corpus.ts";
import { extractPdfReportSource, type PdfSourceDependencies, type PdfUpload } from "./pdf.ts";
import { extractUrlReportSource, type ReportSourceUrlDependencies } from "./url.ts";
import type { ReportSourceCorpus } from "./types.ts";

export {
  INITIAL_PROMPT_SOURCE_ID,
  REPORT_SOURCE_MAX_CORPUS_CHARS,
  REPORT_SOURCE_MAX_EXTRACTED_CHARS,
  REPORT_SOURCE_MAX_PDF_BYTES,
  REPORT_SOURCE_MAX_PDF_PAGES,
  REPORT_SOURCE_MAX_URL_BYTES,
  ReportSourceInputError,
  type ReportSourceChunk,
  type ReportSourceCorpus,
  type ReportSourceKind,
  type ReportSourceSummary,
} from "./types.ts";
export { createReportSourceCorpus } from "./corpus.ts";
export { parseReportSourceActionInput } from "./form-data.ts";
export { extractPdfReportSource, type PdfUpload } from "./pdf.ts";
export { extractUrlReportSource, isPublicReportSourceIp } from "./url.ts";

export type PrepareReportSourcesInput = {
  brief: string;
  url?: string;
  pdf?: PdfUpload;
};

export type PrepareReportSourcesDependencies = {
  url?: ReportSourceUrlDependencies;
  pdf?: PdfSourceDependencies;
  idFactory?: () => string;
};

export async function prepareReportSourceCorpus(
  input: PrepareReportSourcesInput,
  dependencies: PrepareReportSourcesDependencies = {},
): Promise<ReportSourceCorpus> {
  const [urlSource, pdfSource] = await Promise.all([
    input.url ? extractUrlReportSource(input.url, dependencies.url) : null,
    input.pdf ? extractPdfReportSource(input.pdf, dependencies.pdf) : null,
  ]);

  return createReportSourceCorpus(
    input.brief,
    [urlSource, pdfSource].filter((source) => source !== null),
    { idFactory: dependencies.idFactory },
  );
}
