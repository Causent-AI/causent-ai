import type { PdfUpload } from "./pdf.ts";
import { REPORT_SOURCE_MAX_PDF_BYTES, ReportSourceInputError } from "./types.ts";

export type ParsedReportSourceActionInput = {
  brief: string;
  url: string;
  pdf: PdfUpload | undefined;
};

function singleTextField(formData: FormData, name: "brief" | "url"): string {
  const values = formData.getAll(name);
  if (values.length > 1 || values.some((value) => typeof value !== "string")) {
    throw new ReportSourceInputError(
      `invalid_${name}`,
      `Submit only one ${name === "brief" ? "project brief" : "source URL"}.`,
    );
  }
  return typeof values[0] === "string" ? values[0].trim() : "";
}
async function singlePdfField(formData: FormData): Promise<PdfUpload | undefined> {
  const values = formData.getAll("pdf");
  if (values.length === 0) return undefined;
  if (values.length > 1 || !(values[0] instanceof File)) {
    throw new ReportSourceInputError("invalid_pdf", "Upload no more than one PDF source.");
  }

  const file = values[0];
  if (file.size === 0 && file.name === "") return undefined;
  if (file.size === 0 || file.size > REPORT_SOURCE_MAX_PDF_BYTES) {
    throw new ReportSourceInputError(
      "pdf_too_large",
      "Choose one non-empty PDF no larger than 5 MiB.",
    );
  }

  return {
    name: file.name,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

export async function parseReportSourceActionInput(
  input: string | FormData,
): Promise<ParsedReportSourceActionInput> {
  if (typeof input === "string") {
    return { brief: input.trim(), url: "", pdf: undefined };
  }

  return {
    brief: singleTextField(input, "brief"),
    url: singleTextField(input, "url"),
    pdf: await singlePdfField(input),
  };
}
