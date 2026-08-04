import assert from "node:assert/strict";
import { test } from "node:test";

import { extractPdfReportSource, type PdfSourceDependencies } from "./pdf.ts";
import {
  REPORT_SOURCE_MAX_PDF_BYTES,
  REPORT_SOURCE_MAX_PDF_PAGES,
  ReportSourceInputError,
} from "./types.ts";

function pdfBytes(extra = ""): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${extra}\n%%EOF`);
}

function minimalTextPdf(): Uint8Array {
  const content =
    "BT /F1 12 Tf 72 720 Td (Checkout completion reached 62 percent in the cohort.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content) + 1} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

type TestParserResult = {
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
};

function parser(
  result: TestParserResult,
  onDestroy?: () => void,
): NonNullable<PdfSourceDependencies["parserFactory"]> {
  return () => ({
    parse: async () => result,
    destroy: async () => onDestroy?.(),
  });
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ReportSourceInputError && error.code === code,
  );
}

test("PDF ingestion returns page-structured text and destroys the parser", async () => {
  let destroyed = false;
  const result = await extractPdfReportSource(
    {
      name: "folder/Study.pdf",
      type: "application/pdf",
      bytes: pdfBytes(),
    },
    {
      parserFactory: parser(
        {
          pageCount: 2,
          pages: [
            { pageNumber: 1, text: "Study objective and method." },
            { pageNumber: 2, text: "Completion reached 62% in the cohort." },
          ],
        },
        () => {
          destroyed = true;
        },
      ),
    },
  );

  assert.equal(result.label, "Study.pdf");
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.sections.map((section) => section.locator), ["Page 1", "Page 2"]);
  assert.equal(destroyed, true);
});

test("installed PDF parser extracts a bounded real text PDF", async () => {
  const result = await extractPdfReportSource({
    name: "actual.pdf",
    type: "application/pdf",
    bytes: minimalTextPdf(),
  });

  assert.equal(result.pageCount, 1);
  assert.match(result.sections[0].text, /Checkout completion reached 62 percent/);
});

test("PDF ingestion rejects type, filename, signature, size, and unsafe feature indicators", async () => {
  const validParser = { parserFactory: parser({ pageCount: 1, pages: [] }) };
  await rejectsWithCode(
    extractPdfReportSource(
      { name: "study.pdf", type: "text/plain", bytes: pdfBytes() },
      validParser,
    ),
    "pdf_type",
  );
  await rejectsWithCode(
    extractPdfReportSource(
      { name: "study.txt", type: "application/pdf", bytes: pdfBytes() },
      validParser,
    ),
    "pdf_name",
  );
  await rejectsWithCode(
    extractPdfReportSource(
      { name: "study.pdf", type: "application/pdf", bytes: new TextEncoder().encode("not pdf") },
      validParser,
    ),
    "pdf_signature",
  );
  await rejectsWithCode(
    extractPdfReportSource({
      name: "study.pdf",
      type: "application/pdf",
      bytes: new Uint8Array(REPORT_SOURCE_MAX_PDF_BYTES + 1),
    }),
    "pdf_too_large",
  );
  for (const marker of ["/Encrypt", "/OpenAction", "/JavaScript", "/EmbeddedFile"]) {
    await rejectsWithCode(
      extractPdfReportSource(
        { name: "study.pdf", type: "application/pdf", bytes: pdfBytes(marker) },
        validParser,
      ),
      "pdf_unsafe_feature",
    );
  }
});

test("PDF ingestion rejects excessive pages, image-only text, malformed data, and timeouts", async () => {
  const upload = { name: "study.pdf", type: "application/pdf", bytes: pdfBytes() };
  await rejectsWithCode(
    extractPdfReportSource(upload, {
      parserFactory: parser({ pageCount: REPORT_SOURCE_MAX_PDF_PAGES + 1, pages: [] }),
    }),
    "pdf_pages",
  );
  await rejectsWithCode(
    extractPdfReportSource(upload, {
      parserFactory: parser({ pageCount: 1, pages: [{ pageNumber: 1, text: "   " }] }),
    }),
    "pdf_no_text",
  );
  await rejectsWithCode(
    extractPdfReportSource(upload, {
      parserFactory: () => ({
        parse: async () => {
          throw new Error("broken xref");
        },
        destroy: async () => undefined,
      }),
    }),
    "pdf_malformed",
  );
  await rejectsWithCode(
    extractPdfReportSource(upload, {
      timeoutMs: 5,
      parserFactory: () => ({
        parse: () => new Promise(() => undefined),
        destroy: async () => undefined,
      }),
    }),
    "pdf_timeout",
  );
});
