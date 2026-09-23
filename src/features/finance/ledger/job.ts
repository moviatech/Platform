import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncStripe } from "../stripe-sync";
import { runDailyChecks } from "./daily-checks";
import { financeBook, financeLiveKey, runEngine } from "./engine";
import { runSnapshots } from "./snapshots";
import { runSteps, summarizeRun, type StepOutcome } from "./steps";

const job = "tick";
const budgetMs = 15000;
const leaseSeconds = 120;

export type FinanceTick = { skipped: true } | { skipped: false; ok: boolean; runId: number | null; error: string | null; steps: StepOutcome[] };

export async function runFinanceTick(host: string | null = null): Promise<FinanceTick> {
  const supabase = createAdminClient();
  const holder = randomUUID();
  const { data: taken, error } = await supabase.rpc("fin_take_lease", { p_job: job, p_holder: holder, p_seconds: leaseSeconds });
  if (error) throw new Error(`finance_lease: ${error.message}`);
  if (!taken) return { skipped: true };
  try {
    const started = Date.now();
    const opened = await supabase.from("fin_job_runs").insert({ job, started_at: new Date(started).toISOString(), counts: { host } }).select("id").single();
    const runId = (opened.data?.id as number | undefined) ?? null;
    const book = financeBook();
    const liveKey = book === "live" ? financeLiveKey() : null;
    const deadline = started + budgetMs;
    const steps = await runSteps(
      [
        { name: "snapshots", run: () => runSnapshots(deadline) },
        ...(book === "live" ? [{ name: "stripe", run: () => syncStripe() }] : []),
        { name: "ledger", run: () => runEngine({ book, liveKey, deadline }) },
        { name: "checks", run: () => runDailyChecks({ book, liveKey }) },
      ],
      budgetMs,
    );
    const finished = Date.now();
    let logError = opened.error ? `finance_run_log: ${opened.error.message}` : null;
    if (runId !== null) {
      const summary = summarizeRun(steps);
      const closed = await supabase.from("fin_job_runs").update({ finished_at: new Date(finished).toISOString(), ok: summary.ok, counts: { host, ms: finished - started, steps }, error: summary.error }).eq("id", runId);
      if (closed.error) logError = `finance_run_log: ${closed.error.message}`;
    }
    const result = summarizeRun(steps, logError);
    if (!result.ok) console.error("[finance:tick]", result.error);
    return { skipped: false, ok: result.ok, runId, error: result.error, steps };
  } finally {
    const released = await supabase.rpc("fin_release_lease", { p_job: job, p_holder: holder });
    if (released.error) console.error("[finance:tick] lease release failed", released.error.message);
  }
}
