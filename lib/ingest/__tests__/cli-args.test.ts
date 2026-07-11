// Unit tests for the ingest CLI's argument parsing (lib/ingest/cli-args.ts).
// Locks the P3 hardening fix: a missing flag value used to yield a NaN window /
// undefined scope and silently ingest nothing. Run: `node --test lib/ingest`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, USAGE } from "../cli-args.ts";

const SCOPE = "ca5e0000-0000-0000-0000-0000000000d3";

test("parseArgs maps owner/repo and valid flags", () => {
  const opts = parseArgs(["acme", "widgets", "--window", "30", "--max", "50", "--scope", SCOPE]);
  assert.deepEqual(opts, {
    scopeId: SCOPE,
    owner: "acme",
    repo: "widgets",
    windowDays: 30,
    maxItems: 50,
  });
});

test("parseArgs defaults scope to the demo scope and leaves caps unset", () => {
  const opts = parseArgs(["acme", "widgets"]);
  assert.equal(opts.owner, "acme");
  assert.equal(opts.repo, "widgets");
  assert.equal(typeof opts.scopeId, "string");
  assert.equal(opts.windowDays, undefined);
  assert.equal(opts.maxItems, undefined);
});

test("parseArgs throws usage when owner/repo are missing", () => {
  assert.throws(() => parseArgs([]), new RegExp(USAGE.slice(0, 20)));
  assert.throws(() => parseArgs(["acme"]), /usage:/);
});

test("parseArgs rejects a missing flag value (the silent-NaN bug)", () => {
  assert.throws(() => parseArgs(["acme", "widgets", "--window"]), /missing value for --window/);
  // A flag directly followed by another flag is also a missing value.
  assert.throws(
    () => parseArgs(["acme", "widgets", "--window", "--max"]),
    /missing value for --window/,
  );
});

test("parseArgs rejects non-positive or non-numeric window/max", () => {
  assert.throws(() => parseArgs(["acme", "widgets", "--window", "abc"]), /positive integer/);
  assert.throws(() => parseArgs(["acme", "widgets", "--max", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["acme", "widgets", "--max", "-5"]), /positive integer/);
  assert.throws(() => parseArgs(["acme", "widgets", "--window", "1.5"]), /positive integer/);
});

test("parseArgs rejects a non-UUID scope (silent undefined-scope bug)", () => {
  assert.throws(() => parseArgs(["acme", "widgets", "--scope", "not-a-uuid"]), /must be a UUID/);
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["acme", "widgets", "--frobnicate", "1"]), /unknown flag/);
});
