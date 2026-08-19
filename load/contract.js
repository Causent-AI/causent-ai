export const ACTIVE_WORKSPACE_COOKIE = "causent_active_workspace";
export const SESSION_ALLOCATION_POLICY = "single-use-supabase-session-per-vu-profile-disjoint-v1";

export const PROFILE_SESSION_CAPACITY = Object.freeze({
  smoke: 1,
  steady: 400,
  burst: 1200,
  hot_workspace: 200,
  mixed_write: 500,
  soak: 400,
  adversarial: 50,
});

export const PROFILE_SESSION_MIN_VALIDITY_MS = Object.freeze({
  smoke: 2 * 60 * 1000,
  steady: 15 * 60 * 1000,
  burst: 10 * 60 * 1000,
  hot_workspace: 15 * 60 * 1000,
  mixed_write: 15 * 60 * 1000,
  soak: 130 * 60 * 1000,
  adversarial: 15 * 60 * 1000,
});

const LOGIN_DESTINATION = /^(?:https?:\/\/[^/]+)?\/login(?:[/?#]|$)/i;
const SUPABASE_AUTH_COOKIE = /-auth-token(?:\.\d+)?$/i;
const SUPABASE_AUTH_COOKIE_PART = /^(.+-auth-token)(?:\.(\d+))?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_POOL_SET = /^github:[1-9][0-9]*:[1-9][0-9]*$/;
const SESSION_POOL_LEASE = /^(github:[1-9][0-9]*:[1-9][0-9]*):(smoke|steady|burst|hot_workspace|mixed_write|soak|adversarial)$/;
const BROKER_PLACEHOLDER = /(changeme|replaceme|placeholder|notsecure|dummy|example|sample|testsecret)/i;
const MAX_ISSUED_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const MAX_LEASE_LIFETIME_MS = 4 * 60 * 60 * 1000;

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";

  const requested = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== requested) continue;
    return Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return "";
}

function decodeBase64Url(value, label) {
  const unpadded = String(value ?? "").replace(/=+$/, "");
  if (!unpadded || !/^[a-z0-9_-]+$/i.test(unpadded) || unpadded.length % 4 === 1) {
    throw new Error(`${label} is not valid base64url.`);
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  let bits = 0;
  let bitCount = 0;
  const bytes = [];
  for (const character of normalized) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error(`${label} is not valid base64url.`);
    bits = (bits << 6) | digit;
    bitCount += 6;
    if (bitCount < 8) continue;
    bitCount -= 8;
    bytes.push((bits >> bitCount) & 0xff);
    bits &= (1 << bitCount) - 1;
  }

  try {
    return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function parseSupabaseSessionIdentity(cookies, label) {
  const authParts = cookies.flatMap((cookie) => {
    const match = SUPABASE_AUTH_COOKIE_PART.exec(cookie.name);
    return match ? [{ baseName: match[1].toLowerCase(), index: match[2], value: cookie.value }] : [];
  });
  const baseNames = new Set(authParts.map((part) => part.baseName));
  if (authParts.length === 0 || baseNames.size !== 1) {
    throw new Error(`${label} must include exactly one Supabase auth-token cookie family.`);
  }

  const unchunked = authParts.filter((part) => part.index === undefined);
  const chunked = authParts.filter((part) => part.index !== undefined);
  let encodedSession;
  if (unchunked.length === 1 && chunked.length === 0) {
    encodedSession = unchunked[0].value;
  } else if (unchunked.length === 0 && chunked.length > 0) {
    chunked.sort((left, right) => Number(left.index) - Number(right.index));
    if (chunked.some((part, index) => Number(part.index) !== index)) {
      throw new Error(`${label} contains incomplete Supabase auth-token chunks.`);
    }
    encodedSession = chunked.map((part) => part.value).join("");
  } else {
    throw new Error(`${label} mixes chunked and unchunked Supabase auth cookies.`);
  }

  const serializedSession = encodedSession.startsWith("base64-")
    ? decodeBase64Url(encodedSession.slice("base64-".length), `${label} session`)
    : encodedSession;
  let session;
  try {
    session = JSON.parse(serializedSession);
  } catch {
    throw new Error(`${label} does not contain a serialized Supabase session.`);
  }
  const accessToken = typeof session?.access_token === "string" ? session.access_token : "";
  const refreshToken = typeof session?.refresh_token === "string" ? session.refresh_token : "";
  const jwtParts = accessToken.split(".");
  if (!refreshToken || jwtParts.length !== 3) {
    throw new Error(`${label} must include access and refresh tokens.`);
  }

  let claims;
  try {
    claims = JSON.parse(decodeBase64Url(jwtParts[1], `${label} access-token payload`));
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error;
    throw new Error(`${label} access-token payload must be valid JSON.`);
  }
  const authSessionId = typeof claims?.session_id === "string" ? claims.session_id.trim() : "";
  const subjectId = typeof claims?.sub === "string" ? claims.sub.trim() : "";
  if (!UUID.test(authSessionId) || !UUID.test(subjectId)) {
    throw new Error(`${label} access token must identify a Supabase user session.`);
  }
  return { authSessionId, refreshToken, subjectId };
}

export function parseCookieHeader(cookieHeader) {
  return String(cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return [];
      return [{
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
      }];
    })
    .filter((cookie) => cookie.name.length > 0 && cookie.value.length > 0);
}

function parseStrictSessionHeader(cookieHeader, label) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) {
    throw new Error(`${label} must be a non-empty Cookie header.`);
  }

  const parts = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies = parseCookieHeader(cookieHeader);
  if (cookies.length !== parts.length) {
    throw new Error(`${label} contains a malformed cookie.`);
  }

  const names = new Set();
  for (const cookie of cookies) {
    const normalizedName = cookie.name.toLowerCase();
    if (names.has(normalizedName)) {
      throw new Error(`${label} contains a duplicate cookie name.`);
    }
    names.add(normalizedName);
  }

  const authCookies = cookies.filter((cookie) => SUPABASE_AUTH_COOKIE.test(cookie.name));
  const sessionIdentity = parseSupabaseSessionIdentity(cookies, label);

  const authFingerprint = authCookies
    .map((cookie) => `${cookie.name.toLowerCase()}=${cookie.value}`)
    .sort()
    .join(";");
  const normalizedHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return { authFingerprint, cookies, normalizedHeader, ...sessionIdentity };
}

export function validateSessionPoolBrokerConfig({ token, url }) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(url ?? ""));
  } catch {
    throw new Error("Session pool broker URL must be valid HTTPS.");
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    parsedUrl.protocol !== "https:" ||
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error("Session pool broker URL must be non-local HTTPS without embedded credentials.");
  }

  const candidate = typeof token === "string" ? token.trim() : "";
  const distinctCharacters = new Set(candidate).size;
  const safeTokenShape = /^(?:[0-9a-f]{64}|[a-z0-9_-]{43,128})$/i.test(candidate);
  if (
    !safeTokenShape ||
    distinctCharacters < 12 ||
    BROKER_PLACEHOLDER.test(candidate) ||
    /^(.{1,16})\1+$/.test(candidate)
  ) {
    throw new Error("Session pool broker token must be a strong secret.");
  }
  return parsedUrl.toString();
}

export function parseSessionCookiePoolEnvelope(rawEnvelope, expected, nowMs = Date.now()) {
  let decoded;
  try {
    decoded = JSON.parse(String(rawEnvelope ?? ""));
  } catch {
    throw new Error("Session cookie pool response must be valid JSON.");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Session cookie pool response must be a JSON object.");
  }

  const profile = String(expected?.profile ?? "");
  const leaseId = String(expected?.leaseId ?? "");
  const allocationSetId = String(expected?.allocationSetId ?? "");
  const requiredCapacity = requiredSessionPoolCapacity(profile);
  const leaseMatch = SESSION_POOL_LEASE.exec(leaseId);
  if (
    !SESSION_POOL_SET.test(allocationSetId) ||
    !leaseMatch ||
    leaseMatch[1] !== allocationSetId ||
    leaseMatch[2] !== profile
  ) {
    throw new Error("Session cookie pool lease must bind the GitHub run, attempt, and profile.");
  }
  if (
    decoded.version !== 1 ||
    decoded.profile !== profile ||
    decoded.allocationSetId !== allocationSetId ||
    decoded.leaseId !== leaseId ||
    decoded.allocationPolicy !== SESSION_ALLOCATION_POLICY
  ) {
    throw new Error("Session cookie pool response does not match the requested lease.");
  }

  const issuedAt = typeof decoded.issuedAt === "string" ? decoded.issuedAt : "";
  const expiresAt = typeof decoded.expiresAt === "string" ? decoded.expiresAt : "";
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  const canonicalTimestamps =
    Number.isFinite(issuedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    new Date(issuedAtMs).toISOString() === issuedAt &&
    new Date(expiresAtMs).toISOString() === expiresAt;
  const minimumValidity = PROFILE_SESSION_MIN_VALIDITY_MS[profile];
  if (
    !canonicalTimestamps ||
    issuedAtMs < nowMs - MAX_ISSUED_AGE_MS ||
    issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    expiresAtMs < nowMs + minimumValidity ||
    expiresAtMs > issuedAtMs + MAX_LEASE_LIFETIME_MS
  ) {
    throw new Error("Session cookie pool response is stale or expires before the profile completes.");
  }

  if (!Array.isArray(decoded.sessions) || decoded.sessions.length !== requiredCapacity) {
    throw new Error(`Session cookie pool response must include exactly ${requiredCapacity} sessions.`);
  }
  const authFingerprints = new Set();
  const authSessionIds = new Set();
  const refreshTokens = new Set();
  const pool = decoded.sessions.map((session, index) => {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw new Error(`Session cookie pool entry ${index + 1} is invalid.`);
    }
    const identity = typeof session.id === "string" ? session.id.trim() : "";
    const parsed = parseStrictSessionHeader(
      session.cookieHeader,
      `Session cookie pool entry ${index + 1}`,
    );
    if (
      identity !== `${leaseId}:vu-${index + 1}:${parsed.authSessionId}` ||
      session.authSessionId !== parsed.authSessionId ||
      session.subjectId !== parsed.subjectId
    ) {
      throw new Error("Every session identity must bind one requested lease and VU to its Supabase auth session.");
    }
    if (authFingerprints.has(parsed.authFingerprint)) {
      throw new Error("Every VU must use a distinct Supabase session.");
    }
    if (authSessionIds.has(parsed.authSessionId) || refreshTokens.has(parsed.refreshToken)) {
      throw new Error("Every VU must use a distinct Supabase auth-session lineage.");
    }
    authFingerprints.add(parsed.authFingerprint);
    authSessionIds.add(parsed.authSessionId);
    refreshTokens.add(parsed.refreshToken);
    return parsed.normalizedHeader;
  });
  return pool;
}

export function requiredSessionPoolCapacity(profile) {
  const capacity = PROFILE_SESSION_CAPACITY[profile];
  if (!capacity) throw new Error(`Unknown load profile: ${profile}`);
  return capacity;
}

export function requireSessionPoolCapacity(pool, profile) {
  const required = requiredSessionPoolCapacity(profile);
  if (!Array.isArray(pool) || pool.length < required) {
    throw new Error(`Load profile ${profile} requires ${required} distinct sessions.`);
  }
  return pool;
}

export function sessionCookieHeaderForVu(pool, vuId) {
  if (!Number.isInteger(vuId) || vuId < 1 || vuId > pool.length) {
    throw new Error("Every active VU must have its own session cookie.");
  }
  return pool[vuId - 1];
}

export function parseAdversarialControl({ cookieHeader, marker, workspaceId }, loadPool = []) {
  const normalizedMarker = typeof marker === "string" ? marker.trim() : "";
  if (normalizedMarker.length < 8) {
    throw new Error("Adversarial foreign-tenant marker must contain at least 8 characters.");
  }
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId.trim())) {
    throw new Error("Adversarial foreign workspace ID must be a UUID.");
  }

  const control = parseStrictSessionHeader(cookieHeader, "Adversarial foreign session cookie");
  for (const loadHeader of loadPool) {
    const loadSession = parseStrictSessionHeader(loadHeader, "Load session cookie");
    if (
      loadSession.authFingerprint === control.authFingerprint ||
      loadSession.authSessionId === control.authSessionId ||
      loadSession.refreshToken === control.refreshToken
    ) {
      throw new Error("Adversarial control must use a session outside the load-user pool.");
    }
  }

  const cookies = control.cookies.filter(
    (cookie) => cookie.name.toLowerCase() !== ACTIVE_WORKSPACE_COOKIE.toLowerCase(),
  );
  cookies.push({ name: ACTIVE_WORKSPACE_COOKIE, value: workspaceId.trim() });
  return {
    cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    marker: normalizedMarker,
    workspaceId: workspaceId.trim(),
  };
}

export function isSuccessfulStatus(response) {
  return response.status >= 200 && response.status < 300;
}

export function hasDocumentBody(response) {
  return typeof response.body === "string" && response.body.length > 0;
}

export function redirectsToLogin(response) {
  const finalUrl = String(response.url ?? "").trim();
  const location = headerValue(response.headers, "location").trim();
  return LOGIN_DESTINATION.test(finalUrl) || LOGIN_DESTINATION.test(location);
}

export function isProtectedDocumentResponse(response) {
  return isSuccessfulStatus(response) && hasDocumentBody(response) && !redirectsToLogin(response);
}
