import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, request as undiciRequest } from "undici";

import { extractStructuralHtmlText } from "./html.ts";
import {
  REPORT_SOURCE_MAX_EXTRACTED_CHARS,
  REPORT_SOURCE_MAX_URL_BYTES,
  ReportSourceInputError,
  normalizedSourceText,
  type ExtractedReportSource,
} from "./types.ts";

export const REPORT_SOURCE_URL_MAX_REDIRECTS = 3;
export const REPORT_SOURCE_URL_TIMEOUT_MS = 10_000;
const REPORT_SOURCE_URL_MAX_LENGTH = 2_048;

type LookupAddress = { address: string; family: number };
type HeaderValue = string | string[] | undefined;
type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export type ReportSourceHttpResponse = {
  statusCode: number;
  headers: Record<string, HeaderValue>;
  body: AsyncIterable<Uint8Array>;
  discard?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
};

export type ReportSourceUrlDependencies = {
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
  request?: (
    url: URL,
    pinnedAddress: LookupAddress,
    signal: AbortSignal,
  ) => Promise<ReportSourceHttpResponse>;
  timeoutMs?: number;
};

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split(".").map(Number);
  return bytes.length === 4 && bytes.every((byte) => byte >= 0 && byte <= 255)
    ? bytes
    : null;
}

function expandIpv6(address: string): number[] | null {
  if (address.includes("%")) return null;
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) !== 6) return null;

  const [leftRaw, rightRaw] = normalized.split("::");
  if (normalized.split("::").length > 2) return null;
  const parseSide = (side: string | undefined): number[] => {
    if (!side) return [];
    const values: number[] = [];
    for (const part of side.split(":")) {
      if (part.includes(".")) {
        const bytes = ipv4Bytes(part);
        if (!bytes) return [];
        values.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else {
        values.push(Number.parseInt(part, 16));
      }
    }
    return values;
  };

  const left = parseSide(leftRaw);
  const right = parseSide(rightRaw);
  const omitted = 8 - left.length - right.length;
  const groups = normalized.includes("::")
    ? [...left, ...Array(Math.max(0, omitted)).fill(0), ...right]
    : left;
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

export function isPublicReportSourceIp(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) {
    const [a, b, c] = v4;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  const v6 = expandIpv6(address.replace(/^\[|\]$/g, ""));
  if (!v6) return false;
  const [a, b] = v6;

  if (v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff) {
    const embedded = `${v6[6] >> 8}.${v6[6] & 255}.${v6[7] >> 8}.${v6[7] & 255}`;
    return isPublicReportSourceIp(embedded);
  }

  if (v6.slice(0, 6).every((group) => group === 0)) return false;

  return !(
    v6.every((group) => group === 0) ||
    (v6.slice(0, 7).every((group) => group === 0) && v6[7] === 1) ||
    (a & 0xfe00) === 0xfc00 ||
    (a & 0xffc0) === 0xfe80 ||
    (a & 0xffc0) === 0xfec0 ||
    (a & 0xff00) === 0xff00 ||
    (a === 0x0064 && b === 0xff9b) ||
    (a === 0x0100 && b === 0) ||
    (a === 0x2001 && b < 0x0200) ||
    (a === 0x2001 && b === 0x0db8) ||
    (a === 0x3fff && b < 0x1000) ||
    a === 0x2002
  );
}

function parseReportSourceUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > REPORT_SOURCE_URL_MAX_LENGTH) {
    throw new ReportSourceInputError(
      "invalid_url",
      "Enter one HTTPS URL no longer than 2,048 characters.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ReportSourceInputError("invalid_url", "Enter a complete HTTPS URL.");
  }

  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ReportSourceInputError(
      "unsafe_url",
      "The source URL must use HTTPS on port 443 and cannot include credentials.",
    );
  }

  const hostname = normalizedHostname(url);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new ReportSourceInputError("private_url", "The source URL must resolve to a public host.");
  }

  return url;
}

async function resolvePublicAddress(
  url: URL,
  lookup: NonNullable<ReportSourceUrlDependencies["lookup"]>,
  signal: AbortSignal,
): Promise<LookupAddress> {
  const hostname = normalizedHostname(url);
  if (isIP(hostname)) {
    if (!isPublicReportSourceIp(hostname)) {
      throw new ReportSourceInputError("private_url", "The source URL must resolve to a public host.");
    }
    return { address: hostname, family: isIP(hostname) };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error("Source URL request timed out."));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      lookup(hostname).then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  } catch {
    if (signal.aborted) {
      throw new ReportSourceInputError(
        "url_timeout",
        "That page took too long to respond. Try a smaller or faster source page.",
      );
    }
    throw new ReportSourceInputError(
      "url_lookup_failed",
      "Causent could not resolve that source URL. Check the address and try again.",
    );
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicReportSourceIp(address))) {
    throw new ReportSourceInputError("private_url", "The source URL must resolve only to public hosts.");
  }
  const selected = addresses.find(({ address }) => isIP(address) === 4) ?? addresses[0];
  return { address: selected.address, family: isIP(selected.address) };
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family }));
}

export function answerPinnedReportSourceLookup(
  pinnedAddress: LookupAddress,
  options: number | { all?: boolean },
  callback: PinnedLookupCallback,
): void {
  if (typeof options === "object" && options.all) {
    callback(null, [pinnedAddress]);
    return;
  }
  callback(null, pinnedAddress.address, pinnedAddress.family);
}

async function defaultRequest(
  url: URL,
  pinnedAddress: LookupAddress,
  signal: AbortSignal,
): Promise<ReportSourceHttpResponse> {
  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        // Node 26's happy-eyeballs path asks custom resolvers for `all` results.
        // Returning the legacy scalar callback shape in that mode is interpreted
        // as an address list and eventually becomes `undefined`, which defeats
        // the request before it reaches the already validated pinned address.
        answerPinnedReportSourceLookup(pinnedAddress, options, callback);
      },
      timeout: 5_000,
    },
    headersTimeout: 5_000,
    bodyTimeout: 5_000,
    maxResponseSize: REPORT_SOURCE_MAX_URL_BYTES,
    maxCachedSessions: 0,
    pipelining: 0,
  });

  try {
    const response = await undiciRequest(url, {
      dispatcher: agent,
      method: "GET",
      signal,
      headers: {
        accept: "text/html, text/plain;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "CausentSourceReader/1.0",
      },
    });

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
      discard: () => {
        response.body.destroy();
      },
      dispose: () => agent.close(),
    };
  } catch (error) {
    await agent.close();
    throw error;
  }
}

function firstHeader(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function discardResponse(response: ReportSourceHttpResponse): Promise<void> {
  try {
    await response.discard?.();
  } catch {
    // The response is being rejected; cleanup failures must not replace the safe user error.
  }
}

async function disposeResponse(response: ReportSourceHttpResponse): Promise<void> {
  try {
    await response.dispose?.();
  } catch {
    // The body outcome is authoritative; transport cleanup cannot change it.
  }
}

async function readBoundedBody(response: ReportSourceHttpResponse): Promise<Uint8Array> {
  const declaredLength = Number(firstHeader(response.headers["content-length"]));
  if (Number.isFinite(declaredLength) && declaredLength > REPORT_SOURCE_MAX_URL_BYTES) {
    await discardResponse(response);
    throw new ReportSourceInputError(
      "url_too_large",
      "That page is too large to use as a source. Choose a page under 1 MiB.",
    );
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > REPORT_SOURCE_MAX_URL_BYTES) {
      await discardResponse(response);
      throw new ReportSourceInputError(
        "url_too_large",
        "That page is too large to use as a source. Choose a page under 1 MiB.",
      );
    }
    chunks.push(chunk);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function safeUrlLocator(url: URL): string {
  return `${url.origin}${url.pathname}`.slice(0, REPORT_SOURCE_URL_MAX_LENGTH);
}

export async function extractUrlReportSource(
  rawUrl: string,
  dependencies: ReportSourceUrlDependencies = {},
): Promise<ExtractedReportSource> {
  const lookup = dependencies.lookup ?? defaultLookup;
  const request = dependencies.request ?? defaultRequest;
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error("Source URL request timed out.")),
    dependencies.timeoutMs ?? REPORT_SOURCE_URL_TIMEOUT_MS,
  );

  try {
    let currentUrl = parseReportSourceUrl(rawUrl);
    for (let redirectCount = 0; redirectCount <= REPORT_SOURCE_URL_MAX_REDIRECTS; redirectCount += 1) {
      const pinnedAddress = await resolvePublicAddress(currentUrl, lookup, timeoutController.signal);
      let response: ReportSourceHttpResponse;
      try {
        response = await request(currentUrl, pinnedAddress, timeoutController.signal);
      } catch {
        if (timeoutController.signal.aborted) {
          throw new ReportSourceInputError(
            "url_timeout",
            "That page took too long to respond. Try a smaller or faster source page.",
          );
        }
        throw new ReportSourceInputError(
          "url_fetch_failed",
          "Causent could not read that page. Confirm it is publicly available and try again.",
        );
      }

      try {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = firstHeader(response.headers.location);
          await discardResponse(response);
          if (!location || redirectCount === REPORT_SOURCE_URL_MAX_REDIRECTS) {
            throw new ReportSourceInputError(
              "url_redirect",
              "That page redirects too many times or has an invalid redirect.",
            );
          }
          try {
            currentUrl = parseReportSourceUrl(new URL(location, currentUrl).toString());
          } catch (error) {
            if (error instanceof ReportSourceInputError) throw error;
            throw new ReportSourceInputError(
              "url_redirect",
              "That page returned an invalid redirect.",
            );
          }
          continue;
        }

        if (response.statusCode !== 200) {
          await discardResponse(response);
          throw new ReportSourceInputError(
            "url_status",
            "That page is not publicly readable. Choose a page that returns a normal web response.",
          );
        }

        const encoding = firstHeader(response.headers["content-encoding"])?.trim().toLowerCase();
        if (encoding && encoding !== "identity") {
          await discardResponse(response);
          throw new ReportSourceInputError(
            "url_encoding",
            "That page did not honor the bounded plain-response request. Choose another source page.",
          );
        }

        const contentType = firstHeader(response.headers["content-type"])
          ?.split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (contentType !== "text/html" && contentType !== "text/plain") {
          await discardResponse(response);
          throw new ReportSourceInputError(
            "url_content_type",
            "The source URL must return HTML or plain text.",
          );
        }

        let bytes: Uint8Array;
        try {
          bytes = await readBoundedBody(response);
        } catch (error) {
          if (error instanceof ReportSourceInputError) throw error;
          if (timeoutController.signal.aborted) {
            throw new ReportSourceInputError(
              "url_timeout",
              "That page took too long to respond. Try a smaller or faster source page.",
            );
          }
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "UND_ERR_RES_EXCEEDED_MAX_SIZE"
          ) {
            throw new ReportSourceInputError(
              "url_too_large",
              "That page is too large to use as a source. Choose a page under 1 MiB.",
            );
          }
          throw new ReportSourceInputError(
            "url_fetch_failed",
            "Causent could not finish reading that page. Try the source again.",
          );
        }
        let decoded: string;
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new ReportSourceInputError(
            "url_text_encoding",
            "The source page must use valid UTF-8 text.",
          );
        }

        const extracted =
          contentType === "text/html"
            ? extractStructuralHtmlText(decoded)
            : { title: null, text: normalizedSourceText(decoded) };
        if (extracted.text.length < 20) {
          throw new ReportSourceInputError(
            "url_no_text",
            "Causent could not find enough readable text on that page.",
          );
        }
        if (extracted.text.length > REPORT_SOURCE_MAX_EXTRACTED_CHARS) {
          throw new ReportSourceInputError(
            "url_text_too_large",
            "That page contains too much readable text. Choose a more focused page.",
          );
        }

        return {
          kind: "url",
          label: extracted.title ?? currentUrl.hostname.slice(0, 160),
          locator: safeUrlLocator(currentUrl),
          pageCount: null,
          sections: [{ text: extracted.text, locator: safeUrlLocator(currentUrl) }],
        };
      } finally {
        await disposeResponse(response);
      }
    }

    throw new ReportSourceInputError("url_redirect", "That page redirects too many times.");
  } finally {
    clearTimeout(timeout);
  }
}
