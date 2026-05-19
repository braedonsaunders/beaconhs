/**
 * webhook-out — first-party BeaconHS plugin.
 *
 * Forwards every event whose type the manifest declares (and that the
 * tenant has subscribed to) to a tenant-configured URL with an HMAC
 * SHA-256 signature.
 *
 * The plugin runner injects two arguments:
 *   ctx     — { pluginKey, tenantId, settings, db, secrets, log,
 *               fireWebhook(name, body, extraHeaders?) }
 *   event   — { eventId, type, category, tenantId, actorId,
 *               occurredAt, payload }
 *
 * Settings shape (jsonb on tenant_plugins.settings):
 *   {
 *     "webhooks": {
 *       "primary": {
 *         "url":    "https://customer.example/webhook/beaconhs",
 *         "secret": "shared-hmac-secret"
 *       }
 *     }
 *   }
 *
 * NOTE: This file runs inside the runner's vm.SourceTextModule, which
 * forbids `require`, `import`, `fs`, `process.env`, and `child_process`.
 * The handler relies only on the globals the runner provides: `fetch`,
 * `crypto`, `URL`, `URLSearchParams`, `console`.
 */

async function handler(ctx, event) {
  // Re-validate URL on every invocation rather than caching: a tenant
  // can update settings between runs and we want the next event to use
  // the new value immediately.
  const cfg = (ctx.settings && ctx.settings.webhooks && ctx.settings.webhooks.primary) || null;
  if (!cfg || !cfg.url) {
    ctx.log("warn", "no webhook url configured; skipping event", {
      eventId: event.eventId,
      type: event.type,
    });
    return { skipped: true, reason: "no_url" };
  }

  // Build the body once. We POST the whole envelope so receivers can
  // disambiguate event types in a single handler.
  const body = {
    eventId: event.eventId,
    type: event.type,
    category: event.category,
    tenantId: event.tenantId,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };

  ctx.log("info", "firing webhook", {
    name: "primary",
    type: event.type,
    eventId: event.eventId,
  });

  // The runner's fireWebhook computes the HMAC, sets the signature
  // header, and POSTs. It also records latency in plugin_runs.output.
  // We just need to pass the body + any extra headers the receiver wants.
  const result = await ctx.fireWebhook("primary", body, {
    "X-BeaconHS-Event-Id": event.eventId,
    "X-BeaconHS-Event-Type": event.type,
  });

  // If the receiver rejects the event, surface that as a plugin-run
  // failure so the admin UI flags it. 2xx is success; everything
  // else throws so the run row goes to "failed".
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      "webhook receiver returned " +
        result.status +
        ": " +
        result.bodyText.slice(0, 500),
    );
  }

  return {
    delivered: true,
    status: result.status,
    eventId: event.eventId,
  };
}

// The runner expects `handler` to be defined at module scope and to be
// reachable as a global symbol. The sandbox treats this file as a
// SourceTextModule; declaring `handler` here exposes it on
// globalThis automatically inside the sandboxed context.
