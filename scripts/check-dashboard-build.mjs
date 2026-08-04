#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const dashboardRoutes = [
  { appPath: "/(dashboard)/actions/page", publicPath: "/actions" },
  { appPath: "/(dashboard)/data-workshop/page", publicPath: "/data-workshop" },
  { appPath: "/(dashboard)/impact/page", publicPath: "/impact" },
  { appPath: "/(dashboard)/reports/page", publicPath: "/reports" },
];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Could not read ${path}; run the webpack production build first. ${detail}`);
  }
}

const appPaths = await readJson(".next/server/app-paths-manifest.json");
const prerender = await readJson(".next/prerender-manifest.json");
const staticPaths = new Set([
  ...Object.keys(prerender.routes ?? {}),
  ...Object.keys(prerender.dynamicRoutes ?? {}),
]);

const missing = dashboardRoutes.filter(({ appPath }) => !(appPath in appPaths));
const incorrectlyStatic = dashboardRoutes.filter(({ publicPath }) => staticPaths.has(publicPath));

if (missing.length > 0 || incorrectlyStatic.length > 0) {
  console.error(JSON.stringify({
    event: "dashboard_build_contract_invalid",
    missingRoutes: missing.map(({ publicPath }) => publicPath),
    staticallyPrerenderedRoutes: incorrectlyStatic.map(({ publicPath }) => publicPath),
  }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    event: "dashboard_build_contract_valid",
    requestBoundRoutes: dashboardRoutes.map(({ publicPath }) => publicPath),
  }));
}
