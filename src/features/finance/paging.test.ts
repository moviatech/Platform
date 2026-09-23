import { describe, expect, it } from "vitest";
import { readAll } from "./paging";

const pages = (total: number) => (from: number, to: number) => Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, index) => from + index), error: null });

describe("readAll", () => {
  it("reads every page until a short one", async () => {
    expect(await readAll<number>(pages(1201), { pageSize: 500 })).toHaveLength(1201);
    expect(await readAll<number>(pages(0))).toEqual([]);
  });

  it("stops at the row limit, and refuses to truncate in strict mode", async () => {
    expect(await readAll<number>(pages(3000), { pageSize: 500, maxRows: 1000 })).toHaveLength(1000);
    await expect(readAll<number>(pages(3000), { pageSize: 500, maxRows: 1000, strict: true })).rejects.toThrow("finance_rows_limit");
    expect(await readAll<number>(pages(999), { pageSize: 500, maxRows: 1000, strict: true })).toHaveLength(999);
  });

  it("throws on a query error", async () => {
    await expect(readAll<number>(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("finance_query_failed: boom");
  });
});
