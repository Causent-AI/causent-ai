import assert from "node:assert/strict";
import { test } from "node:test";

import { chunkSourceText, createReportSourceCorpus } from "./corpus.ts";
import {
  INITIAL_PROMPT_SOURCE_ID,
  REPORT_SOURCE_MAX_CHUNK_CHARS,
  REPORT_SOURCE_MAX_CORPUS_CHARS,
  ReportSourceInputError,
} from "./types.ts";

test("corpus builder assigns server-owned source and chunk IDs", () => {
  let nextId = 0;
  const corpus = createReportSourceCorpus(
    "A project brief with enough detail.",
    [
      {
        kind: "url",
        label: "Research",
        locator: "https://example.com/research",
        pageCount: null,
        sections: [{ text: "The study observed a 61% completion rate.", locator: null }],
      },
    ],
    { idFactory: () => `owned-${++nextId}` },
  );

  assert.equal(corpus.sources[0].sourceId, INITIAL_PROMPT_SOURCE_ID);
  assert.equal(corpus.chunks[0].chunkId, INITIAL_PROMPT_SOURCE_ID);
  assert.equal(corpus.sources[1].sourceId, "source-owned-1");
  assert.equal(corpus.chunks[1].chunkId, "chunk-owned-2");
  assert.equal(corpus.chunks[1].sourceId, corpus.sources[1].sourceId);
  assert.equal(corpus.sources[1].finalOrigin, "https://example.com");
  assert.equal(corpus.sources[1].chunks[0].chunkId, "chunk-owned-2");
  assert.equal(corpus.sources[1].chunks[0].locator, "https://example.com/research");
  assert.equal(corpus.sources[1].chunks[0].text, "The study observed a 61% completion rate.");
  assert.match(corpus.sources[1].chunks[0].contentSha256, /^[0-9a-f]{64}$/);
  assert.match(corpus.sources[1].contentSha256, /^[0-9a-f]{64}$/);
});

test("chunker preserves all normalized text inside bounded chunks", () => {
  const text = `${"alpha ".repeat(600)}\n\n${"beta ".repeat(600)}`;
  const chunks = chunkSourceText(text);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= REPORT_SOURCE_MAX_CHUNK_CHARS));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), text.replace(/\s+/g, " ").trim());
});

test("combined source corpus rejects text beyond the model-input ceiling", () => {
  assert.throws(
    () =>
      createReportSourceCorpus("A sufficiently detailed project brief.", [
        {
          kind: "pdf",
          label: "large.pdf",
          locator: "large.pdf",
          pageCount: 1,
          sections: [
            { text: "a".repeat(REPORT_SOURCE_MAX_CORPUS_CHARS / 2), locator: "Page 1" },
          ],
        },
        {
          kind: "url",
          label: "Large page",
          locator: "https://example.com/large",
          pageCount: null,
          sections: [
            {
              text: "b".repeat(REPORT_SOURCE_MAX_CORPUS_CHARS / 2),
              locator: "https://example.com/large",
            },
          ],
        },
      ]),
    (error: unknown) =>
      error instanceof ReportSourceInputError && error.code === "corpus_too_large",
  );
});
