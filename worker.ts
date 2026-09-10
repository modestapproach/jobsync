// Custom Worker entrypoint.
//
// OpenNext generates the HTTP handler for the Next.js app; this file re-uses it
// unchanged and adds the one thing a Next.js app cannot express on its own: a
// Cron Trigger. Each trigger performs a scheduler tick by invoking the app's
// own /api/automations/tick route in-process, so the tick runs through the
// same code, telemetry and DB bindings as a normal request. No network hop.
import { default as handler } from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
}

export default {
  fetch: handler.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (!env.CRON_SECRET) {
      console.error("[worker] CRON_SECRET is not set; skipping scheduler tick");
      return;
    }
    const request = new Request("https://jobsync.internal/api/automations/tick", {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET },
    });
    try {
      const response = await handler.fetch(request, env as never, ctx);
      if (!response.ok) {
        console.error(`[worker] scheduler tick failed: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.error("[worker] scheduler tick error", error);
    }
  },
} satisfies ExportedHandler<Env>;
