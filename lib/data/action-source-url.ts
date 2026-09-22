/** Source metadata is untrusted, including URLs stored by older imports. */
export function safeActionSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname !== "github.com" ||
      !/^\/[^/]+\/[^/]+\/(pull|issues)\/[1-9][0-9]*\/?$/.test(url.pathname)
    )
      return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}
