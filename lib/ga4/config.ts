import { openToken, sealToken } from "./crypto.ts";
import type { GoogleConfig } from "./google.ts";

export type Ga4Config = GoogleConfig & { encryptionKey: string; workerJwt: string; overlapDays: number };

export function ga4Config(env: Record<string, string | undefined> = process.env): Ga4Config {
  if (env.CAUSENT_GA4_ENABLED !== "1" || env.CAUSENT_LOCAL_DEMO === "1" || env.CAUSENT_USE_SEED === "1") throw new Error("GA4_DISABLED");
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`GA4_CONFIG_${name}`);
    return value;
  };
  const redirectUri = required("GA4_REDIRECT_URI");
  const url = new URL(redirectUri);
  if ((url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
      || url.pathname !== "/api/ga4/callback" || url.search || url.hash || url.username || url.password) throw new Error("GA4_REDIRECT_INVALID");
  const encryptionKey = required("GA4_ENCRYPTION_KEY");
  // Validate the key without retaining a test ciphertext or exposing key values.
  openToken(sealToken("check", encryptionKey, "config"), encryptionKey, "config");
  const workerJwt = required("GA4_WORKER_JWT");
  try {
    const claims = JSON.parse(Buffer.from(workerJwt.split(".")[1], "base64url").toString("utf8"));
    if (claims.role !== "causent_ga4_worker" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error();
  } catch { throw new Error("GA4_WORKER_JWT_INVALID"); }
  const overlapDays = Number(env.GA4_OVERLAP_DAYS ?? 7);
  if (!Number.isInteger(overlapDays) || overlapDays < 7 || overlapDays > 180) throw new Error("GA4_OVERLAP_INVALID");
  return { clientId: required("GA4_CLIENT_ID"), clientSecret: required("GA4_CLIENT_SECRET"), redirectUri, encryptionKey, workerJwt, overlapDays };
}
