// CLI argument parsing for lib/ingest/cli.ts, split out so it can be unit-
// tested: cli.ts transitively imports lib/supabase-server.ts (server-only),
// which throws under plain `node --test`. This module stays pure.

// Relative imports (not @/* aliases): this module is exercised by plain
// `node --test`, which doesn't resolve the tsconfig path alias for value imports.
import { DEMO_SCOPE_ID } from "../data/config.ts";
import type { IngestOptions } from "./github.ts";

export const USAGE =
  "usage: cli.ts <owner> <repo> [--window N] [--max N] [--scope UUID]";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse + validate CLI args. Fails loudly on a missing/invalid flag value —
 *  a silent NaN window or undefined scope would ingest nothing and look like
 *  success. */
export function parseArgs(argv: string[]): IngestOptions {
  const [owner, repo, ...rest] = argv;
  if (!owner || !repo) throw new Error(USAGE);
  const opts: IngestOptions = { scopeId: DEMO_SCOPE_ID, owner, repo };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}\n${USAGE}`);
    }
    if (flag === "--window" || flag === "--max") {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${flag} must be a positive integer, got "${value}"\n${USAGE}`);
      }
      if (flag === "--window") opts.windowDays = n;
      else opts.maxItems = n;
    } else if (flag === "--scope") {
      if (!UUID_RE.test(value)) {
        throw new Error(`--scope must be a UUID, got "${value}"\n${USAGE}`);
      }
      opts.scopeId = value;
    } else {
      throw new Error(`unknown flag ${flag}\n${USAGE}`);
    }
  }
  return opts;
}
