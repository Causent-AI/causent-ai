import assert from "node:assert/strict";
import { test } from "node:test";

import { parseReportSourceActionInput } from "./form-data.ts";
import { REPORT_SOURCE_MAX_PDF_BYTES, ReportSourceInputError } from "./types.ts";

test("source action input keeps raw string compatibility", async () => {
  assert.deepEqual(await parseReportSourceActionInput("  A detailed project brief.  "), {
    brief: "A detailed project brief.",
    url: "",
    pdf: undefined,
  });
});
test("source action input accepts at most one URL and one bounded PDF", async () => {
  const input = new FormData();
  input.set("brief", "  A detailed project brief.  ");
  input.set("url", "  https://example.com/research  ");
  input.set(
    "pdf",
    new File(["%PDF-1.7\n%%EOF"], "study.pdf", { type: "application/pdf" }),
  );

  const parsed = await parseReportSourceActionInput(input);
  assert.equal(parsed.brief, "A detailed project brief.");
  assert.equal(parsed.url, "https://example.com/research");
  assert.equal(parsed.pdf?.name, "study.pdf");
  assert.equal(new TextDecoder().decode(parsed.pdf?.bytes), "%PDF-1.7\n%%EOF");

  input.append("url", "https://example.org/second");
  await assert.rejects(
    parseReportSourceActionInput(input),
    (error: unknown) => error instanceof ReportSourceInputError && error.code === "invalid_url",
  );
});

test("source action input rejects duplicate and oversized PDF fields before extraction", async () => {
  const duplicates = new FormData();
  duplicates.set("brief", "A detailed project brief.");
  duplicates.append("pdf", new File(["%PDF-"], "one.pdf", { type: "application/pdf" }));
  duplicates.append("pdf", new File(["%PDF-"], "two.pdf", { type: "application/pdf" }));
  await assert.rejects(
    parseReportSourceActionInput(duplicates),
    (error: unknown) => error instanceof ReportSourceInputError && error.code === "invalid_pdf",
  );

  const oversized = new FormData();
  oversized.set("brief", "A detailed project brief.");
  oversized.set(
    "pdf",
    new File([new Uint8Array(REPORT_SOURCE_MAX_PDF_BYTES + 1)], "large.pdf", {
      type: "application/pdf",
    }),
  );
  await assert.rejects(
    parseReportSourceActionInput(oversized),
    (error: unknown) => error instanceof ReportSourceInputError && error.code === "pdf_too_large",
  );
});
