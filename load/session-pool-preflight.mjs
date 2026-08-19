#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const contractSource = await readFile(new URL("./contract.js", import.meta.url), "utf8");
const contract = await import(
  `data:text/javascript;base64,${Buffer.from(contractSource).toString("base64")}`
);

const mode = process.argv[2] ?? "";
try {
  if (mode === "--broker") {
    contract.validateSessionPoolBrokerConfig({
      token: process.env.CAUSENT_LOAD_SESSION_POOL_TOKEN,
      url: process.env.CAUSENT_LOAD_SESSION_POOL_URL,
    });
    console.log(JSON.stringify({ event: "staging_load_broker_valid" }));
    process.exit(0);
  }

  const profile = mode;
  const allocationSetId = process.env.CAUSENT_LOAD_SESSION_COOKIE_POOL_SET;
  const leaseId = process.env.CAUSENT_LOAD_SESSION_COOKIE_POOL_LEASE;
  const poolFile = process.env.CAUSENT_LOAD_SESSION_COOKIE_POOL_FILE;
  if (!poolFile) throw new Error("Session cookie pool file is required.");
  const envelope = await readFile(poolFile, "utf8");
  const pool = contract.parseSessionCookiePoolEnvelope(
    envelope,
    { profile, leaseId, allocationSetId },
  );

  if (profile === "adversarial") {
    contract.parseAdversarialControl({
      cookieHeader: process.env.CAUSENT_LOAD_FOREIGN_SESSION_COOKIE,
      marker: process.env.CAUSENT_LOAD_FORBIDDEN_TENANT_MARKER,
      workspaceId: process.env.CAUSENT_LOAD_FORBIDDEN_WORKSPACE_ID,
    }, pool);
  }

  console.log(JSON.stringify({ event: "staging_load_auth_valid", profile, sessions: pool.length }));
} catch (error) {
  console.error(JSON.stringify({
    event: "staging_load_auth_invalid",
    profile: mode === "--broker" ? undefined : mode,
    error: error instanceof Error ? error.message : "invalid staging-load authentication",
  }));
  process.exitCode = 1;
}
