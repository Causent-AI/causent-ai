export type ReadCompleteness = {
  complete: true;
  rowCount: number;
  limit: number;
  consistency: "keyset";
};

/** Only an empty next page proves completion; a smaller API row cap does not. */
export async function collectKeyset<T>(
  fetchPage: (after: string | null, size: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  key: (row: T) => string,
  maxRows = 10_000,
): Promise<{ rows: T[]; completeness: ReadCompleteness }> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new Error("Invalid read limit");
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await fetchPage(after, Math.min(500, maxRows - rows.length + 1));
    if (error) throw error;
    const page = data ?? [];
    if (!page.length) {
      return { rows, completeness: { complete: true, rowCount: rows.length, limit: maxRows, consistency: "keyset" } };
    }
    for (const row of page) {
      const next = key(row);
      if (!next || (after !== null && next <= after)) throw new Error("Read cursor did not advance");
      after = next;
      rows.push(row);
    }
    if (rows.length > maxRows) throw new Error("Read limit exceeded; request a narrower history window.");
  }
}
