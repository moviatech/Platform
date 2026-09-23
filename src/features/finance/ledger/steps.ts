export type Step = { name: string; run: () => Promise<unknown> };

export type StepOutcome = { name: string; ok: boolean; skipped: boolean; ms: number; result?: unknown; error?: string };

export type PartResult = { table?: string; error?: string | null; skipped?: boolean };

export async function runSteps(steps: Step[], budgetMs: number, now: () => number = () => Date.now()): Promise<StepOutcome[]> {
  const started = now();
  const outcomes: StepOutcome[] = [];
  for (const step of steps) {
    if (now() - started >= budgetMs) {
      outcomes.push({ name: step.name, ok: false, skipped: true, ms: 0 });
      continue;
    }
    const begin = now();
    try {
      const result = await step.run();
      outcomes.push({ name: step.name, ok: true, skipped: false, ms: now() - begin, result });
    } catch (cause) {
      outcomes.push({ name: step.name, ok: false, skipped: false, ms: now() - begin, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return outcomes;
}

export const firstError = (outcomes: StepOutcome[]) => outcomes.find((outcome) => outcome.error)?.error ?? (outcomes.some((outcome) => outcome.skipped) ? "budget_exhausted" : null);

export function summarizeRun(outcomes: StepOutcome[], logError: string | null = null): { ok: boolean; error: string | null } {
  const parts = outcomes.flatMap((outcome) => (Array.isArray(outcome.result) ? (outcome.result as PartResult[]) : []));
  const failed = parts.find((part) => part.error);
  const error = logError ?? firstError(outcomes) ?? (failed ? `${failed.table ?? "part"}: ${failed.error}` : null) ?? (parts.some((part) => part.skipped) ? "budget_exhausted" : null);
  return { ok: error === null, error };
}
