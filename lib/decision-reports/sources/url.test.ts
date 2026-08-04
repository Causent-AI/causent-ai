import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerPinnedReportSourceLookup,
  extractUrlReportSource,
  isPublicReportSourceIp,
  type ReportSourceHttpResponse,
} from "./url.ts";
import { REPORT_SOURCE_MAX_URL_BYTES, ReportSourceInputError } from "./types.ts";

async function* body(value: string | Uint8Array): AsyncGenerator<Uint8Array> {
  yield typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function response(
  value: string | Uint8Array,
  options: {
    statusCode?: number;
    headers?: ReportSourceHttpResponse["headers"];
  } = {},
): ReportSourceHttpResponse {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? { "content-type": "text/html; charset=utf-8" },
    body: body(value),
  };
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ReportSourceInputError && error.code === code,
  );
}

test("IP policy rejects private, loopback, documentation, and mapped-private ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "198.51.100.8",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "fec0::1",
    "100::1234",
    "3fff::1",
    "2606:4700:4700::1111%eth0",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicReportSourceIp(address), false, address);
  }
  assert.equal(isPublicReportSourceIp("8.8.8.8"), true);
  assert.equal(isPublicReportSourceIp("2606:4700:4700::1111"), true);
});

test("pinned URL lookup honors Node scalar and all-address callback shapes", () => {
  const pinned = { address: "8.8.8.8", family: 4 };
  const answers: unknown[][] = [];
  const callback = (...args: unknown[]) => answers.push(args);

  answerPinnedReportSourceLookup(pinned, { all: true }, callback);
  answerPinnedReportSourceLookup(pinned, { all: false }, callback);

  assert.deepEqual(answers, [
    [null, [pinned]],
    [null, pinned.address, pinned.family],
  ]);
});

test("URL ingestion requires HTTPS on 443 without credentials", async () => {
  const dependencies = {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => response("Readable source material for the report."),
  };
  await rejectsWithCode(extractUrlReportSource("http://example.com", dependencies), "unsafe_url");
  await rejectsWithCode(
    extractUrlReportSource("https://user:secret@example.com", dependencies),
    "unsafe_url",
  );
  await rejectsWithCode(
    extractUrlReportSource("https://example.com:8443/page", dependencies),
    "unsafe_url",
  );
});

test("URL ingestion pins a validated public DNS result and returns only safe metadata and text", async () => {
  const requests: Array<{ hostname: string; address: string }> = [];
  const result = await extractUrlReportSource("https://example.com/research?token=secret#part", {
    lookup: async () => [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ],
    request: async (url, pinnedAddress) => {
      requests.push({ hostname: url.hostname, address: pinnedAddress.address });
      return response(
        "<html><head><title>Public study</title></head><body><main>Completion reached 62% in the test cohort.</main><script>ignore me</script></body></html>",
      );
    },
  });

  assert.deepEqual(requests, [{ hostname: "example.com", address: "1.1.1.1" }]);
  assert.equal(result.label, "Public study");
  assert.equal(result.locator, "https://example.com/research");
  assert.equal(result.sections[0].text, "Completion reached 62% in the test cohort.");
  assert.doesNotMatch(JSON.stringify({ label: result.label, locator: result.locator }), /secret/);
});

test("all DNS answers must be public and redirects are revalidated before the next request", async () => {
  let requestCount = 0;
  await rejectsWithCode(
    extractUrlReportSource("https://example.com", {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      request: async () => {
        requestCount += 1;
        return response("unused");
      },
    }),
    "private_url",
  );
  assert.equal(requestCount, 0);

  await rejectsWithCode(
    extractUrlReportSource("https://example.com", {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => {
        requestCount += 1;
        return response("", {
          statusCode: 302,
          headers: { location: "https://127.0.0.1/private" },
        });
      },
    }),
    "private_url",
  );
  assert.equal(requestCount, 1);
});

test("URL ingestion rejects unsupported types, compression, oversized bodies, and invalid UTF-8", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  await rejectsWithCode(
    extractUrlReportSource("https://example.com/file", {
      lookup,
      request: async () => response("binary", { headers: { "content-type": "application/pdf" } }),
    }),
    "url_content_type",
  );
  await rejectsWithCode(
    extractUrlReportSource("https://example.com/gzip", {
      lookup,
      request: async () =>
        response("compressed", {
          headers: { "content-type": "text/plain", "content-encoding": "gzip" },
        }),
    }),
    "url_encoding",
  );
  await rejectsWithCode(
    extractUrlReportSource("https://example.com/large", {
      lookup,
      request: async () =>
        response(new Uint8Array(REPORT_SOURCE_MAX_URL_BYTES + 1), {
          headers: { "content-type": "text/plain" },
        }),
    }),
    "url_too_large",
  );
  await rejectsWithCode(
    extractUrlReportSource("https://example.com/text", {
      lookup,
      request: async () =>
        response(new Uint8Array([0xc3, 0x28]), {
          headers: { "content-type": "text/plain" },
        }),
    }),
    "url_text_encoding",
  );

  await rejectsWithCode(
    extractUrlReportSource("https://example.com/interrupted", {
      lookup,
      request: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        body: (async function* () {
          yield new TextEncoder().encode("Readable text begins here, then ");
          throw new Error("socket reset");
        })(),
      }),
    }),
    "url_fetch_failed",
  );
});

test("transport cleanup failures do not replace an accepted bounded source", async () => {
  const result = await extractUrlReportSource("https://example.com/clean", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => ({
      ...response("This source has enough readable plain text for a report.", {
        headers: { "content-type": "text/plain" },
      }),
      dispose: async () => {
        throw new Error("cleanup failed");
      },
    }),
  });
  assert.equal(result.kind, "url");
});

test("URL ingestion applies one total timeout", async () => {
  await rejectsWithCode(
    extractUrlReportSource("https://example.com/slow", {
      timeoutMs: 5,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async (_url, _address, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    }),
    "url_timeout",
  );

  await rejectsWithCode(
    extractUrlReportSource("https://example.com/slow-dns", {
      timeoutMs: 5,
      lookup: () => new Promise(() => undefined),
      request: async () => response("unused"),
    }),
    "url_timeout",
  );
});
