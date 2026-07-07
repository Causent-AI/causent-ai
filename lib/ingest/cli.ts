// Thin CLI entrypoint for a capped GitHub backfill. Wires the real transport +
// Supabase store into the pure pipeline (lib/ingest/github.ts) and prints the
// IngestResult. This is glue only — all the logic and tests live in github.ts.
//
// Usage (once credentials exist):
//   GITHUB_TOKEN=… npx tsx lib/ingest/cli.ts <owner> <repo> [--window 90] [--max 200] [--scope <uuid>]
//
// TODO(live): running this needs (1) a real GITHUB_TOKEN (repo read) — see
// lib/ingest/github-transport.ts; (2) the Supabase env from .env.local — see
// lib/supabase-server.ts; and (3) a TS-aware runtime (tsx / the Next server),
// since it resolves the `@/*` path alias. It is intentionally NOT exposed as an
// unauthenticated HTTP route: ingestion writes actions and must run under a
// trusted job/user identity once auth lands (docs/designs/security-and-auth.md).

import { DEMO_SCOPE_ID } from "@/lib/data/config";
import { createGitHubTransport } from "@/lib/ingest/github-transport";
import { createSupabaseActionStore } from "@/lib/ingest/github-store";
import { ingestActions, type IngestOptions, type IngestResult } from "@/lib/ingest/github";

function parseArgs(argv: string[]): IngestOptions {
  const [owner, repo, ...rest] = argv;
  if (!owner || !repo) throw new Error("usage: cli.ts <owner> <repo> [--window N] [--max N] [--scope UUID]");
  const opts: IngestOptions = { scopeId: DEMO_SCOPE_ID, owner, repo };
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (rest[i] === "--window") opts.windowDays = Number(value);
    else if (rest[i] === "--max") opts.maxItems = Number(value);
    else if (rest[i] === "--scope") opts.scopeId = value;
  }
  return opts;
}

export async function runCli(argv: string[]): Promise<IngestResult> {
  const opts = parseArgs(argv);
  const result = await ingestActions(createGitHubTransport(), createSupabaseActionStore(), opts);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// Run only when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
