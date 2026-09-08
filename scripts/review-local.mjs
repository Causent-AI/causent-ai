// Restore the existing T05–T10 disposable review stack. Never reset a database
// or read hosted credentials. The sign-in helper serves only the synthetic owner.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, serializeCookieHeader } from "@supabase/ssr";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "causent-t05-t10";
const api = "http://127.0.0.1:57421";
const owner = "7e7e49c8-553f-48fc-8e2a-1fc86a12e579";
const workspace = "5c78b3ac-1da8-4e1f-ad06-d27d3923d0b5";
const email = "review-7ed77a02-48ab-4b4e-bd1b-56fb839162fd@example.test";
const marker = "# Causent isolated T05-T10 review configuration";
const state = resolve(root, ".local-review");
const envPath = resolve(root, ".env.local");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const run = (cmd, args) => execFileSync(cmd, args, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
});
const listening = (port) => new Promise((done) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); done(true); });
  socket.once("error", () => done(false));
});

async function prepare() {
  if (process.env.NODE_ENV === "production") throw new Error("This command is for local development only.");
  if (existsSync(envPath) && !readFileSync(envPath, "utf8").startsWith(marker)) {
    throw new Error("An existing .env.local belongs to another setup; it was preserved. Move it aside before starting this isolated review.");
  }
  try { run("docker", ["info", "--format", "{{.ServerVersion}}"]); }
  catch {
    if (process.platform !== "darwin") throw new Error("Start Docker, then run npm run dev:review again.");
    run("open", ["-a", "Docker"]);
    console.log("Starting Docker Desktop…");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      try { run("docker", ["info", "--format", "{{.ServerVersion}}"]); ready = true; break; }
      catch { /* Docker Desktop is still starting. */ }
    }
    if (!ready) throw new Error("Docker is still starting. Retry once Docker Desktop is ready.");
  }
  const containers = run("docker", ["ps", "-a", "--format", "{{.Names}}"])
    .trim().split("\n").filter((name) => name.startsWith("supabase_") && name.endsWith(`_${project}`));
  if (!containers.includes(`supabase_db_${project}`)) {
    throw new Error("The saved T05–T10 review database is missing. Restore the review fixture before running this command; no database was created or reset.");
  }
  for (const name of containers) {
    if (run("docker", ["inspect", "--format", "{{.State.Running}}", name]).trim() !== "true") {
      run("docker", ["start", name]);
    }
  }
  mkdirSync(resolve(state, "supabase"), { recursive: true, mode: 0o700 });
  let config = readFileSync(resolve(root, "supabase/config.toml"), "utf8")
    .replace('project_id = "causent"', `project_id = "${project}"`);
  for (let n = 0; n < 10; n++) config = config.replaceAll(String(54320 + n), String(57420 + n));
  writeFileSync(resolve(state, "supabase/config.toml"), config);
  const status = JSON.parse(run("supabase", ["status", "--workdir", state, "-o", "json"]));
  if (status.API_URL !== api || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error("The isolated stack returned an unexpected address or incomplete credentials.");
  }
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const health = await fetch(`${api}/auth/v1/health`, {
        headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(2000),
      });
      if (health.ok) { healthy = true; break; }
    } catch { /* Wait for the saved stack to recover after Docker startup. */ }
    await sleep(1000);
  }
  if (!healthy) throw new Error("The isolated authentication service is not ready. Retry when Docker is healthy.");
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    CAUSENT_LOCAL_DEMO: "0",
  };
  writeFileSync(envPath, `${marker}\n${Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  return env;
}

async function serve(env) {
  if (await listening(3125)) {
    const existing = await fetch("http://127.0.0.1:3125/health");
    if (await existing.text() !== project) throw new Error("Port 3125 is occupied by a different service.");
    if (await listening(3115)) {
      console.log("Review is already running: http://localhost:3125/");
      return;
    }
  }
  const admin = createClient(api, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const user = await admin.auth.admin.getUserById(owner);
  if (user.error || user.data.user.email !== email) throw new Error("The expected synthetic review owner is unavailable.");
  const saved = await admin.from("workspaces").select("workspace_id").eq("workspace_id", workspace).single();
  if (saved.error) throw new Error("The saved review workspace is unavailable.");

  let helper;
  if (!(await listening(3125))) {
    const csrf = randomBytes(24).toString("hex");
    helper = createServer(async (req, res) => {
      const host = req.headers.host;
      if (!["localhost:3125", "127.0.0.1:3125"].includes(host)) { res.writeHead(403); res.end(); return; }
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-frame-options", "DENY");
      if (req.method === "GET" && req.url === "/health") { res.end(project); return; }
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(`<!doctype html><title>Causent local review</title><main><h1>Causent local review</h1><p>Open the saved T05–T10 sample workspace.</p><form method="post" action="/signin"><input type="hidden" name="csrf" value="${csrf}"><button>Sign in to local review</button></form></main>`);
        return;
      }
      if (req.method !== "POST" || req.url !== "/signin") { res.writeHead(404); res.end(); return; }
      if (req.headers.origin !== `http://${host}`) { res.writeHead(403); res.end(); return; }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) { res.writeHead(413); res.end(); return; }
      }
      if (new URLSearchParams(body).get("csrf") !== csrf) { res.writeHead(403); res.end(); return; }
      try {
        const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
        if (link.error || link.data.user.id !== owner) throw new Error("Synthetic sign-in unavailable");
        const cookies = [];
        const session = createServerClient(api, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
          cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) },
        });
        const login = await session.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
        if (login.error || login.data.user?.id !== owner) throw new Error("Synthetic session unavailable");
        res.setHeader("set-cookie", [
          ...cookies.map(({ name, value, options }) => serializeCookieHeader(name, value, options)),
          serializeCookieHeader("causent_active_workspace", workspace, { path: "/", sameSite: "lax", httpOnly: true }),
        ]);
        res.writeHead(303, { location: `http://${host.replace(":3125", ":3115")}/data-workshop` });
        res.end();
      } catch {
        res.writeHead(500); res.end("Local sign-in failed. Restart npm run dev:review.");
      }
    });
    await new Promise((done, reject) => { helper.once("error", reject); helper.listen(3125, "127.0.0.1", done); });
  }
  let app;
  if (!(await listening(3115))) {
    app = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3115"], {
      cwd: root, env: { ...process.env, ...env }, stdio: "inherit",
    });
    app.on("exit", () => { helper?.close(); });
  } else console.log("Using the app already running on port 3115. Restart it if it has not reloaded .env.local.");
  console.log("Open http://localhost:3125/ and click Sign in to local review. Keep this terminal running.");
  const close = () => { app?.kill("SIGTERM"); helper?.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

try {
  const env = await prepare();
  console.log("Local review configuration restored; saved database preserved.");
  if (!process.argv.includes("--prepare")) await serve(env);
} catch (error) {
  // CLI errors can include credentials in captured output; show only our own
  // bounded setup messages, never subprocess stdout/stderr or Supabase values.
  console.error(error?.status !== undefined ? "Local review setup failed. Check Docker Desktop and the Supabase CLI, then retry." : error.message);
  process.exitCode = 1;
}
