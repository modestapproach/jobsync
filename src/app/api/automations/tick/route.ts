import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { runDueAutomations, reapStaleRuns } from "@/lib/scheduler";
import { log } from "@/lib/telemetry";

/**
 * Cron entry point for the Workers deployment.
 *
 * On a long-lived Node host the scheduler is an in-process node-cron timer.
 * Workers have no resident process, so the Cloudflare Cron Trigger calls this
 * route (see worker.ts) and it performs one scheduler tick: reap runs that a
 * killed isolate left in "running", then start whatever is due.
 *
 * Auth is a shared secret in the CRON_SECRET header rather than a user
 * session; the trigger has no user and the route must never be reachable
 * without it. A missing secret fails closed.
 */
export const POST = async (req: NextRequest) => {
  const expected = process.env.CRON_SECRET;
  const presented = req.headers.get("x-cron-secret");
  if (!expected || !presented || presented !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const reaped = await reapStaleRuns();
  await runDueAutomations();
  const durationMs = Date.now() - startedAt;
  log.info("[Scheduler] Cron tick completed", {
    "scheduler.reaped": reaped,
    "scheduler.duration_ms": durationMs,
  });
  return NextResponse.json({ ok: true, reaped, durationMs });
};
