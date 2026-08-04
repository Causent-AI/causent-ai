import { createHash, randomUUID } from "node:crypto";

import {
  INITIAL_PROMPT_SOURCE_ID,
  REPORT_SOURCE_MAX_CHUNK_CHARS,
  REPORT_SOURCE_MAX_CORPUS_CHARS,
  REPORT_SOURCE_MAX_EXTRACTED_CHARS,
  ReportSourceInputError,
  normalizedSourceText,
  type ExtractedReportSource,
  type ReportSourceChunk,
  type ReportSourceCorpus,
} from "./types.ts";

type IdFactory = () => string;
type NowFactory = () => Date;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function finalOrigin(kind: ExtractedReportSource["kind"], locator: string | null): string | null {
  if (kind !== "url" || locator === null) return null;
  try {
    return new URL(locator).origin;
  } catch {
    return null;
  }
}

function splitLongBlock(block: string, maxChars: number): string[] {
  const parts: string[] = [];
  let remaining = block.trim();

  while (remaining.length > maxChars) {
    const candidate = remaining.slice(0, maxChars + 1);
    const splitAt = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\n"));
    const boundary = splitAt >= Math.floor(maxChars * 0.6) ? splitAt : maxChars;
    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkSourceText(
  rawText: string,
  maxChars = REPORT_SOURCE_MAX_CHUNK_CHARS,
): string[] {
  const text = normalizedSourceText(rawText);
  if (!text) return [];

  const blocks = text
    .split(/\n{2,}/)
    .flatMap((block) => splitLongBlock(block, maxChars));
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const joined = current ? `${current}\n\n${block}` : block;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }

    if (current) chunks.push(current);
    current = block;
  }

  if (current) chunks.push(current);
  return chunks;
}

export function createReportSourceCorpus(
  brief: string,
  extractedSources: ExtractedReportSource[] = [],
  options: { idFactory?: IdFactory; nowFactory?: NowFactory } = {},
): ReportSourceCorpus {
  const idFactory = options.idFactory ?? randomUUID;
  const retrievedAt = (options.nowFactory ?? (() => new Date()))().toISOString();
  const normalizedBrief = normalizedSourceText(brief);
  if (extractedSources.length > 2) {
    throw new ReportSourceInputError(
      "too_many_sources",
      "Supply no more than one URL and one PDF source.",
    );
  }
  const sources: ReportSourceCorpus["sources"] = [
    {
      sourceId: INITIAL_PROMPT_SOURCE_ID,
      chunks: [],
      kind: "brief",
      label: "Project brief",
      locator: null,
      finalOrigin: null,
      pageCount: null,
      retrievedAt,
      contentSha256: "",
    },
  ];
  const chunks: ReportSourceChunk[] = [];

  const promptChunks = chunkSourceText(normalizedBrief);
  promptChunks.forEach((text, index) => {
    chunks.push({
      chunkId: index === 0 ? INITIAL_PROMPT_SOURCE_ID : `brief-chunk-${idFactory()}`,
      sourceId: INITIAL_PROMPT_SOURCE_ID,
      kind: "brief",
      label: "Project brief",
      locator: null,
      text,
    });
  });

  for (const extracted of extractedSources) {
    const extractedCharacters = extracted.sections.reduce(
      (total, section) => total + normalizedSourceText(section.text).length,
      0,
    );
    if (extractedCharacters < 20) {
      throw new ReportSourceInputError(
        "source_no_text",
        "Causent could not find enough readable text in one supplied source.",
      );
    }
    if (extractedCharacters > REPORT_SOURCE_MAX_EXTRACTED_CHARS) {
      throw new ReportSourceInputError(
        "source_text_too_large",
        "One supplied source contains too much readable text. Use a more focused source.",
      );
    }
    const sourceId = `source-${idFactory()}`;
    sources.push({
      sourceId,
      chunks: [],
      kind: extracted.kind,
      label: extracted.label,
      locator: extracted.locator,
      finalOrigin: finalOrigin(extracted.kind, extracted.locator),
      pageCount: extracted.pageCount,
      retrievedAt,
      contentSha256: "",
    });

    for (const section of extracted.sections) {
      for (const text of chunkSourceText(section.text)) {
        chunks.push({
          chunkId: `chunk-${idFactory()}`,
          sourceId,
          kind: extracted.kind,
          label: extracted.label,
          locator: section.locator ?? extracted.locator,
          text,
        });
      }
    }
  }

  const corpusCharacters = chunks.reduce((total, chunk) => total + chunk.text.length, 0);
  if (corpusCharacters > REPORT_SOURCE_MAX_CORPUS_CHARS) {
    throw new ReportSourceInputError(
      "corpus_too_large",
      "The brief and supplied sources contain too much text together. Use a shorter page or PDF and try again.",
    );
  }

  for (const source of sources) {
    const sourceChunks = chunks.filter((chunk) => chunk.sourceId === source.sourceId);
    source.chunks = sourceChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      locator: chunk.locator,
      contentSha256: sha256(chunk.text),
      text: chunk.text,
    }));
    source.contentSha256 = sha256(sourceChunks.map((chunk) => chunk.text).join("\n\n"));
  }

  return { brief: normalizedBrief, sources, chunks };
}
