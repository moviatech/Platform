type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

export async function readAll<T>(build: (from: number, to: number) => Page, options: { pageSize?: number; maxRows?: number; strict?: boolean } = {}): Promise<T[]> {
  const pageSize = options.pageSize ?? 500;
  const maxRows = options.maxRows ?? 20000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await build(offset, offset + pageSize - 1);
    if (error) throw new Error(`finance_query_failed: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  if (options.strict) throw new Error(`finance_rows_limit: ${maxRows}`);
  return rows;
}
