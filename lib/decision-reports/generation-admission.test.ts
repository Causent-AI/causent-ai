import assert from "node:assert/strict";
import { test } from "node:test";
import { generationRequestIdentity, generationAdmissionMessage, hasValidGenerationReceipt, GenerationAdmissionError } from "./generation-admission.ts";
import { runWithSingleRetry } from "./generation-policy.ts";

test("request identity binds exact source bytes and distinguishes reviewed examples", async () => {
  const input = new FormData();
  input.set("generationRequestId", "30000000-0000-4000-8000-000000000001");
  const parsed = { brief: "A useful source for a report", url: "", pdf: { bytes: new Uint8Array([1,2]) } };
  const first = await generationRequestIdentity(input, parsed);
  assert.deepEqual(await generationRequestIdentity(input, parsed), first);
  assert.notEqual((await generationRequestIdentity(input, {...parsed, pdf: {bytes: new Uint8Array([2,1])}})).inputHash, first.inputHash);
  input.set("reviewExampleId", "example");
  assert.notEqual((await generationRequestIdentity(input, parsed)).inputHash, first.inputHash);
  input.set("generationRequestId", "unsafe");
  await assert.rejects(generationRequestIdentity(input, parsed), GenerationAdmissionError);
});

test("cancellation aborts active work and suppresses retry even if a provider ignores abort", async () => {
  const controller = new AbortController();
  let calls = 0;
  let providerSignal: AbortSignal | undefined;
  const pending = runWithSingleRetry(async (signal) => {
    calls++; providerSignal = signal;
    return new Promise(() => {});
  }, 1000, () => true, controller.signal);
  controller.abort(new GenerationAdmissionError("cancelled"));
  await assert.rejects(pending, /cancelled/);
  assert.equal(calls, 1);
  assert.equal(providerSignal?.aborted, true);
});

test("already cancelled work never starts a provider request", async () => {
  let calls = 0;
  await assert.rejects(runWithSingleRetry(async () => { calls++; }, 1000, () => true, AbortSignal.abort()));
  assert.equal(calls, 0);
  assert.match(generationAdmissionMessage("budget_exhausted"), /tomorrow/);
});

test("completed replay cannot return an expired source capability", () => {
  assert.equal(hasValidGenerationReceipt({sourceReceiptExpiresAt:"2026-09-08T00:00:00Z"}, Date.parse("2026-09-08T00:00:00Z")), false);
  assert.equal(hasValidGenerationReceipt({sourceReceiptExpiresAt:"2026-09-09T00:00:00Z"}, Date.parse("2026-09-08T00:00:00Z")), true);
  assert.equal(hasValidGenerationReceipt({sourceReceiptExpiresAt:"invalid"}), false);
  assert.equal(hasValidGenerationReceipt({}), false);
});
