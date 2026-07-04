// SERVER-ONLY real GitHub transport — the thin adapter that turns the pure
// GitHubTransport interface (lib/ingest/github.ts) into live api.github.com calls.
// This is one of the TWO files that need a real credential to go live; the whole
// ingestion pipeline is exercised without it against fixtures.
//
// TODO(auth / SEC3, T-TOK): the token here is read from process.env.GITHUB_TOKEN
// as a stand-in. In production the GitHub credential is a per-connection PAT/OAuth
// token, encrypted at rest in Vault and DECOUPLED from the login session
// (docs/designs/security-and-auth.md §1). Replace `tokenFromEnv()` with a lookup
// of the caller's/workspace's GitHub connection token, and on a 401/403 that is
// NOT a rate limit, surface a "reconnect GitHub" prompt rather than retrying.

import type { GitHubHttpResponse, GitHubTransport } from "@/lib/ingest/github";

const GITHUB_API = "https://api.github.com";

if (typeof window !== "undefined") {
  throw new Error("lib/ingest/github-transport.ts is server-only (reads a GitHub token).");
}

/** TEMPORARY: single-token source. Replace with per-connection Vault lookup. */
function tokenFromEnv(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Missing GITHUB_TOKEN. Live GitHub ingestion needs a repo-read PAT/OAuth " +
        "token (see the SEC3/T-TOK TODO in this file).",
    );
  }
  return token;
}

/** A fetch-backed transport. `path` is a repo-relative REST path, e.g.
 *  "/repos/acme/orbit/pulls?state=closed&...". */
export function createGitHubTransport(token: string = tokenFromEnv()): GitHubTransport {
  return {
    async fetch(path: string): Promise<GitHubHttpResponse> {
      // WHATWG Response already satisfies GitHubHttpResponse (status/headers.get/json).
      return fetch(`${GITHUB_API}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    },
  };
}
