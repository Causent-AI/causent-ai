export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GA4_METRICS = ["sessions", "engagedSessions", "eventCount"] as const;
export type Ga4Metric = typeof GA4_METRICS[number];
export type Ga4Property = { id: string; name: string; timezone: string };
export type Ga4Observation = { date: string; value: number };
export type Ga4Quality = { thresholded: boolean; sampled: boolean; otherRow: boolean; restricted: boolean };
export type Ga4Report = {
  observations: Ga4Observation[]; quality: Ga4Quality; start: string; end: string;
  timezone: string; rowCount: number; missingDays: number; fetchedAt: string;
};
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class Ga4Error extends Error {
  readonly code: "reauthorize" | "permission" | "quota" | "unavailable" | "invalid_response" | "invalid_request";
  constructor(code: Ga4Error["code"]) {
    super(code);
    this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Ga4Error("invalid_response");
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Ga4Error("invalid_response");
  return value;
}

export function propertyId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) throw new Ga4Error("invalid_request");
  return value;
}

export function metricSelection(metric: unknown, event: unknown = ""): { metric: Ga4Metric; event: string } {
  if (!GA4_METRICS.includes(metric as Ga4Metric) || typeof event !== "string" || event.length > 80
      || (event && !/^[A-Za-z][A-Za-z0-9_]*$/u.test(event)) || (event && metric !== "eventCount")) {
    throw new Ga4Error("invalid_request");
  }
  return { metric: metric as Ga4Metric, event };
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function dailyRange(timezone: string, days: number, now = new Date()): { start: string; end: string } {
  if (!Number.isInteger(days) || days < 1 || days > 180) throw new Ga4Error("invalid_request");
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); }
  catch { throw new Ga4Error("invalid_request"); }
  const part = (kind: string) => parts.find((p) => p.type === kind)?.value;
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  return { start: new Date(today - days * 86400000).toISOString().slice(0, 10), end: new Date(today - 86400000).toISOString().slice(0, 10) };
}

export function syncRange(timezone: string, overlapDays: number, lastAcceptedEnd: string | null, now = new Date()) {
  if (!lastAcceptedEnd) return dailyRange(timezone, 180, now);
  if (!validDate(lastAcceptedEnd)) throw new Ga4Error("invalid_response");
  const end = dailyRange(timezone, 1, now).end;
  const gap = Math.max(0, (Date.parse(end) - Date.parse(lastAcceptedEnd)) / 86400000);
  return dailyRange(timezone, Math.min(180, overlapDays + gap), now);
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const limit = 1_048_576;
  if (!response.body || Number(response.headers.get("content-length")) > limit) throw new Ga4Error("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Ga4Error("invalid_response");
      chunks.push(value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof Ga4Error) throw error;
    throw new Ga4Error("invalid_response");
  } finally { await reader.cancel().catch(() => undefined); }
}

export class GoogleAnalytics {
  private readonly config: GoogleConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly deadline: number;
  constructor(config: GoogleConfig, fetchImpl: typeof fetch = fetch, deadline = Date.now() + 90_000) {
    this.config = config; this.fetchImpl = fetchImpl; this.deadline = deadline;
  }

  authorizationUrl(state: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: "code", scope: `${GA4_SCOPE} openid`, access_type: "offline", prompt: "consent", state }).toString();
    return url.toString();
  }

  private async request(url: string, init: RequestInit, retry = true, emptySuccess = false): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
      try {
        const remaining = this.deadline - Date.now();
        if (remaining <= 0) throw new Ga4Error("unavailable");
        const response = await this.fetchImpl(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.min(15000, remaining)) });
        if ((response.status === 429 || response.status >= 500) && retry && attempt < 2) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        if (response.ok && emptySuccess) { await response.body?.cancel(); return {}; }
        const data = await boundedJson(response);
        if (!response.ok) {
          if (response.status === 401 || data.error === "invalid_grant") throw new Ga4Error("reauthorize");
          if (response.status === 403) throw new Ga4Error("permission");
          if (response.status === 429) throw new Ga4Error("quota");
          throw new Ga4Error("unavailable");
        }
        return data;
      } catch (error) {
        if (error instanceof Ga4Error) throw error;
        throw new Ga4Error("unavailable");
      }
    }
    throw new Ga4Error("unavailable");
  }

  async token(grant: { code: string } | { refreshToken: string }): Promise<{ accessToken: string; refreshToken: string | null }> {
    const params = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret });
    if ("code" in grant) {
      params.set("grant_type", "authorization_code"); params.set("code", grant.code); params.set("redirect_uri", this.config.redirectUri);
    } else { params.set("grant_type", "refresh_token"); params.set("refresh_token", grant.refreshToken); }
    const data = await this.request("https://oauth2.googleapis.com/token", { method: "POST", body: params }, false);
    if (typeof data.scope === "string" && !data.scope.split(" ").includes(GA4_SCOPE)) throw new Ga4Error("permission");
    return { accessToken: text(data.access_token, 8192), refreshToken: data.refresh_token ? text(data.refresh_token, 8192) : null };
  }

  async subject(accessToken: string): Promise<string> {
    return text((await this.request("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } })).sub, 255);
  }

  async properties(accessToken: string): Promise<Array<{ id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    const seen = new Set<string>();
    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
      url.search = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) }).toString();
      const data = await this.request(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const accounts = data.accountSummaries ?? [];
      if (!Array.isArray(accounts)) throw new Ga4Error("invalid_response");
      for (const account of accounts) {
        const properties = object(account).propertySummaries ?? [];
        if (!Array.isArray(properties)) throw new Ga4Error("invalid_response");
        for (const raw of properties) {
          const property = object(raw);
          const resource = text(property.property);
          if (!/^properties\/[1-9][0-9]{0,19}$/u.test(resource)) throw new Ga4Error("invalid_response");
          const id = resource.slice(11);
          result.set(id, { id, name: text(property.displayName) });
        }
      }
      if (result.size > 4000) throw new Ga4Error("invalid_response");
      if (!data.nextPageToken) return [...result.values()];
      pageToken = text(data.nextPageToken, 4096);
      if (seen.has(pageToken)) throw new Ga4Error("invalid_response");
      seen.add(pageToken);
    }
    throw new Ga4Error("invalid_response");
  }

  async property(accessToken: string, id: string): Promise<Ga4Property> {
    const data = await this.request(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId(id)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (data.name !== `properties/${id}` || data.deleteTime) throw new Ga4Error("permission");
    const timezone = text(data.timeZone, 100);
    dailyRange(timezone, 1);
    return { id, name: text(data.displayName), timezone };
  }

  async report(accessToken: string, property: Ga4Property, metric: Ga4Metric, event: string, range: { start: string; end: string }): Promise<Ga4Report> {
    metricSelection(metric, event); propertyId(property.id);
    const expectedDays = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
    if (!validDate(range.start) || !validDate(range.end) || expectedDays < 1 || expectedDays > 180) throw new Ga4Error("invalid_request");
    const observations: Ga4Observation[] = [];
    const dates = new Set<string>();
    const quality: Ga4Quality = { thresholded: false, sampled: false, otherRow: false, restricted: false };
    let total: number | null = null;
    for (let page = 0; page < 3; page++) {
      const data = await this.request(`https://analyticsdata.googleapis.com/v1beta/properties/${property.id}:runReport`, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dateRanges: [{ startDate: range.start, endDate: range.end }], dimensions: [{ name: "date" }],
          metrics: [{ name: metric }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: "100", offset: String(observations.length),
          keepEmptyRows: true, returnPropertyQuota: true,
          ...(event ? { dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: event, caseSensitive: true } } } } : {}) }),
      });
      const metadata = object(data.metadata);
      if (metadata.timeZone !== property.timezone) throw new Ga4Error("invalid_response");
      for (const flag of ["subjectToThresholding", "dataLossFromOtherRow"]) {
        if (metadata[flag] !== undefined && typeof metadata[flag] !== "boolean") throw new Ga4Error("invalid_response");
      }
      if (metadata.samplingMetadatas !== undefined && !Array.isArray(metadata.samplingMetadatas)) throw new Ga4Error("invalid_response");
      const headers = data.metricHeaders;
      const dimensions = data.dimensionHeaders;
      if (!Array.isArray(headers) || headers.length !== 1 || object(headers[0]).name !== metric
          || !Array.isArray(dimensions) || dimensions.length !== 1 || object(dimensions[0]).name !== "date") throw new Ga4Error("invalid_response");
      const count = data.rowCount ?? 0;
      if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > expectedDays || (total !== null && total !== count)) throw new Ga4Error("invalid_response");
      total = count as number;
      quality.thresholded ||= metadata.subjectToThresholding === true;
      quality.otherRow ||= metadata.dataLossFromOtherRow === true;
      quality.sampled ||= Array.isArray(metadata.samplingMetadatas) && metadata.samplingMetadatas.length > 0;
      const restrictions = metadata.schemaRestrictionResponse ? object(metadata.schemaRestrictionResponse).activeMetricRestrictions : null;
      if (restrictions !== undefined && restrictions !== null && !Array.isArray(restrictions)) throw new Ga4Error("invalid_response");
      quality.restricted ||= Array.isArray(restrictions) && restrictions.length > 0;
      const rows = data.rows ?? [];
      if (!Array.isArray(rows) || rows.length > 100 || (rows.length === 0 && observations.length < total)) throw new Ga4Error("invalid_response");
      for (const raw of rows) {
        const row = object(raw);
        if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 1 || !Array.isArray(row.metricValues) || row.metricValues.length !== 1) throw new Ga4Error("invalid_response");
        const rawDate = text(object(row.dimensionValues[0]).value, 8);
        const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
        const rawValue = text(object(row.metricValues[0]).value, 30);
        const value = Number(rawValue);
        if (!/^\d{8}$/u.test(rawDate) || !validDate(date) || date < range.start || date > range.end || dates.has(date)
            || !/^\d+$/u.test(rawValue) || !Number.isSafeInteger(value) || value > 1e15) throw new Ga4Error("invalid_response");
        dates.add(date); observations.push({ date, value });
      }
      if (observations.length > total) throw new Ga4Error("invalid_response");
      if (observations.length === total) return { observations: observations.sort((a, b) => a.date.localeCompare(b.date)), quality, ...range,
        timezone: property.timezone, rowCount: total, missingDays: expectedDays - total, fetchedAt: new Date().toISOString() };
    }
    throw new Ga4Error("invalid_response");
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.request("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: refreshToken }) }, false, true);
  }
}
