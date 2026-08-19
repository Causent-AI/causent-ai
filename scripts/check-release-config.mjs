#!/usr/bin/env node

import { validateReleaseConfig } from "../lib/runtime-config.ts";

const target = process.argv[2] ?? "app";
if (target !== "app" && target !== "worker" && target !== "resolver" && target !== "drift") {
  console.error("usage: node scripts/check-release-config.mjs [app|worker|resolver|drift]");
  process.exitCode = 2;
} else {
  const result = validateReleaseConfig(target, process.env);
  if (!result.ok) {
    console.error(
      JSON.stringify({
        event: "release_config_invalid",
        target,
        issues: result.issues,
      }),
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ event: "release_config_valid", target }));
  }
}
