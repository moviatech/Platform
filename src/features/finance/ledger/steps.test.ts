import { describe, expect, it } from "vitest";
import { firstError, runSteps, summarizeRun, type StepOutcome } from "./steps";

const clock = (ticks: number[]) => {
  let index = 0;
  return () => ticks[Math.min(index++, ticks.length - 1)];
};

describe("runSteps", () => {
  it("runs every step and keeps results", async () => {
    const outcomes = await runSteps(
      [
        { name: "a", run: async () => 1 },
        { name: "b", run: async () => ({ changed: 2 }) },
      ],
      15000,
    );
    expect(outcomes.map((outcome) => [outcome.name, outcome.ok, outcome.skipped])).toEqual([
      ["a", true, false],
      ["b", true, false],
    ]);
    expect(outcomes[1].result).toEqual({ changed: 2 });
    expect(firstError(outcomes)).toBeNull();
  });

  it("isolates a failing step", async () => {
    const outcomes = await runSteps(
      [
        { name: "a", run: async () => Promise.reject(new Error("boom")) },
        { name: "b", run: async () => "fine" },
      ],
      15000,
    );
    expect(outcomes[0]).toMatchObject({ name: "a", ok: false, skipped: false, error: "boom" });
    expect(outcomes[1]).toMatchObject({ name: "b", ok: true, result: "fine" });
    expect(firstError(outcomes)).toBe("boom");
  });

  it("does not start a step once the budget is used", async () => {
    let ran = false;
    const outcomes = await runSteps(
      [
        { name: "a", run: async () => 1 },
        {
          name: "b",
          run: async () => {
            ran = true;
          },
        },
      ],
      15000,
      clock([0, 0, 16000, 16000]),
    );
    expect(outcomes[1]).toMatchObject({ name: "b", ok: false, skipped: true });
    expect(ran).toBe(false);
    expect(firstError(outcomes)).toBe("budget_exhausted");
  });

  it("reports non-Error rejections as text", async () => {
    const outcomes = await runSteps([{ name: "a", run: async () => Promise.reject("plain") }], 15000);
    expect(outcomes[0].error).toBe("plain");
  });
});

describe("summarizeRun", () => {
  const step = (result: unknown, extra: Partial<StepOutcome> = {}): StepOutcome => ({ name: "snapshots", ok: true, skipped: false, ms: 5, result, ...extra });

  it("is ok when every part succeeded", () => {
    expect(summarizeRun([step([{ table: "payments", error: null }, { table: "refunds", error: null }])])).toEqual({ ok: true, error: null });
  });

  it("names the first failing part", () => {
    expect(summarizeRun([step([{ table: "payments", error: null }, { table: "refunds", error: "permission denied" }])])).toEqual({ ok: false, error: "refunds: permission denied" });
  });

  it("flags parts skipped for time", () => {
    expect(summarizeRun([step([{ table: "payments", error: null }, { table: "refunds", error: null, skipped: true }])])).toEqual({ ok: false, error: "budget_exhausted" });
  });

  it("puts a failed run log first", () => {
    expect(summarizeRun([step([{ table: "payments", error: "x" }])], "finance_run_log: denied")).toEqual({ ok: false, error: "finance_run_log: denied" });
  });

  it("reports a failed step before part errors", () => {
    expect(summarizeRun([step(undefined, { ok: false, error: "finance_snapshot_sources: down" })])).toEqual({ ok: false, error: "finance_snapshot_sources: down" });
  });
});
