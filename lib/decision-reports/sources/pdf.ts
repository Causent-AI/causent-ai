import { Worker } from "node:worker_threads";

import {
  REPORT_SOURCE_MAX_EXTRACTED_CHARS,
  REPORT_SOURCE_MAX_PDF_BYTES,
  REPORT_SOURCE_MAX_PDF_PAGES,
  ReportSourceInputError,
  normalizedSourceText,
  type ExtractedReportSource,
} from "./types.ts";

export const REPORT_SOURCE_PDF_TIMEOUT_MS = 12_000;
export const REPORT_SOURCE_PDF_MAX_HEAP_MB = 128;

export type PdfUpload = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

type PdfParserResult = {
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
};

type PdfParser = {
  parse: () => Promise<PdfParserResult>;
  destroy: () => Promise<void>;
};

export type PdfSourceDependencies = {
  parserFactory?: (bytes: Uint8Array) => PdfParser;
  timeoutMs?: number;
};

function safePdfName(name: string): string {
  const baseName = name.split(/[\\/]/).at(-1) ?? "source.pdf";
  const normalized = baseName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (normalized || "source.pdf").slice(0, 120);
}

function findUnsafePdfFeature(bytes: Uint8Array): string | null {
  const raw = Buffer.from(bytes).toString("latin1");
  const indicators: Array<[RegExp, string]> = [
    [/\/Encrypt\b/, "encrypted"],
    [/\/(?:OpenAction|AA|JavaScript|JS|Launch|RichMedia)\b/, "active content"],
    [/\/(?:EmbeddedFile|Filespec)\b/, "embedded files"],
  ];
  return indicators.find(([pattern]) => pattern.test(raw))?.[1] ?? null;
}

type PdfWorkerMessage =
  | { ok: true; result: PdfParserResult }
  | { ok: false; code: string; message: string };

const PDF_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { PDFParse } = require("pdf-parse");

function normalize(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

(async () => {
  let parser;
  try {
    parser = new PDFParse({
      data: new Uint8Array(workerData.bytes),
      enableXfa: false,
      isEvalSupported: false,
      maxImageSize: 1,
      stopAtErrors: true,
      useSystemFonts: false,
    });
    const info = await parser.getInfo();
    if (info.total > workerData.maxPages) {
      parentPort.postMessage({ ok: true, result: { pageCount: info.total, pages: [] } });
      return;
    }
    const extracted = await parser.getText();
    const pages = [];
    let characters = 0;
    for (const page of extracted.pages) {
      const text = normalize(page.text);
      characters += text.length;
      if (characters > workerData.maxCharacters) {
        parentPort.postMessage({
          ok: false,
          code: "pdf_text_too_large",
          message: "That PDF contains too much readable text. Upload a shorter, more focused PDF.",
        });
        return;
      }
      if (text) pages.push({ pageNumber: page.num, text });
    }
    parentPort.postMessage({
      ok: true,
      result: { pageCount: extracted.total, pages },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name.toLowerCase() : "";
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    parentPort.postMessage({
      ok: false,
      code: name.includes("password") || message.includes("password")
        ? "pdf_encrypted"
        : "pdf_malformed",
      message: name.includes("password") || message.includes("password")
        ? "Password-protected or encrypted PDFs are not supported."
        : "Causent could not parse that PDF. Export a standard text-based PDF and try again.",
    });
  } finally {
    if (parser) {
      try { await parser.destroy(); } catch {}
    }
  }
})().catch(() => process.exit(1));
`;

function parsePdfInWorker(bytes: Uint8Array, timeoutMs: number): Promise<PdfParserResult> {
  // Buffer.slice() is a view over its slab; force an exact independent copy so
  // the worker sees the PDF at byte zero and transfer detaches no caller data.
  const transferable = Uint8Array.from(bytes);
  const worker = new Worker(PDF_WORKER_SOURCE, {
    eval: true,
    workerData: {
      bytes: transferable.buffer,
      maxPages: REPORT_SOURCE_MAX_PDF_PAGES,
      maxCharacters: REPORT_SOURCE_MAX_EXTRACTED_CHARS,
    },
    transferList: [transferable.buffer],
    resourceLimits: {
      maxOldGenerationSizeMb: REPORT_SOURCE_PDF_MAX_HEAP_MB,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4,
    },
  });

  return new Promise<PdfParserResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new ReportSourceInputError(
        "pdf_timeout",
        "That PDF took too long to inspect. Try a smaller text-based PDF.",
      )));
    }, timeoutMs);
    worker.once("message", (message: PdfWorkerMessage) => {
      finish(() => {
        if (message.ok) resolve(message.result);
        else reject(new ReportSourceInputError(message.code, message.message));
      });
    });
    worker.once("error", () => {
      finish(() => reject(new ReportSourceInputError(
        "pdf_resource_limit",
        "That PDF exceeded the safe parsing limit. Try a smaller text-based PDF.",
      )));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new ReportSourceInputError(
          "pdf_resource_limit",
          "That PDF exceeded the safe parsing limit. Try a smaller text-based PDF.",
        )));
      }
    });
  });
}

async function parseWithInjectedParser(parser: PdfParser, timeoutMs: number): Promise<PdfParserResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      parser.parse(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ReportSourceInputError(
            "pdf_timeout",
            "That PDF took too long to inspect. Try a smaller text-based PDF.",
          )),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      await parser.destroy();
    } catch {
      // Test-only dependency cleanup cannot replace the bounded parse result.
    }
  }
}

export async function extractPdfReportSource(
  upload: PdfUpload,
  dependencies: PdfSourceDependencies = {},
): Promise<ExtractedReportSource> {
  const name = safePdfName(upload.name);
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > REPORT_SOURCE_MAX_PDF_BYTES) {
    throw new ReportSourceInputError(
      "pdf_too_large",
      "Choose one non-empty PDF no larger than 5 MiB.",
    );
  }
  if (upload.type && upload.type !== "application/pdf") {
    throw new ReportSourceInputError("pdf_type", "The uploaded source must be a PDF file.");
  }
  if (!name.toLowerCase().endsWith(".pdf")) {
    throw new ReportSourceInputError("pdf_name", "The uploaded source must have a .pdf filename.");
  }
  if (Buffer.from(upload.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new ReportSourceInputError("pdf_signature", "That file does not have a valid PDF signature.");
  }

  const unsafeFeature = findUnsafePdfFeature(upload.bytes);
  if (unsafeFeature) {
    throw new ReportSourceInputError(
      "pdf_unsafe_feature",
      `That PDF contains ${unsafeFeature}, which this bounded importer does not accept.`,
    );
  }

  try {
    const timeoutMs = dependencies.timeoutMs ?? REPORT_SOURCE_PDF_TIMEOUT_MS;
    const result = dependencies.parserFactory
      ? await parseWithInjectedParser(dependencies.parserFactory(upload.bytes.slice()), timeoutMs)
      : await parsePdfInWorker(upload.bytes, timeoutMs);

    if (
      !Number.isInteger(result.pageCount) ||
      result.pageCount < 1 ||
      result.pageCount > REPORT_SOURCE_MAX_PDF_PAGES
    ) {
      throw new ReportSourceInputError(
        "pdf_pages",
        `Choose a PDF with no more than ${REPORT_SOURCE_MAX_PDF_PAGES} pages.`,
      );
    }

    const pages = result.pages
      .map((page) => ({
        pageNumber: page.pageNumber,
        text: normalizedSourceText(page.text),
      }))
      .filter((page) => page.text.length > 0);
    const extractedCharacters = pages.reduce((total, page) => total + page.text.length, 0);
    if (extractedCharacters < 20) {
      throw new ReportSourceInputError(
        "pdf_no_text",
        "Causent could not find readable text in that PDF. Scanned PDFs need OCR before upload.",
      );
    }
    if (extractedCharacters > REPORT_SOURCE_MAX_EXTRACTED_CHARS) {
      throw new ReportSourceInputError(
        "pdf_text_too_large",
        "That PDF contains too much readable text. Upload a shorter, more focused PDF.",
      );
    }

    return {
      kind: "pdf",
      label: name,
      locator: name,
      pageCount: result.pageCount,
      sections: pages.map((page) => ({
        text: page.text,
        locator: `Page ${page.pageNumber}`,
      })),
    };
  } catch (error) {
    if (error instanceof ReportSourceInputError) throw error;
    const name = error instanceof Error ? error.name.toLowerCase() : "";
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (name.includes("password") || message.includes("password")) {
      throw new ReportSourceInputError(
        "pdf_encrypted",
        "Password-protected or encrypted PDFs are not supported.",
      );
    }
    throw new ReportSourceInputError(
      "pdf_malformed",
      "Causent could not parse that PDF. Export a standard text-based PDF and try again.",
    );
  }
}
