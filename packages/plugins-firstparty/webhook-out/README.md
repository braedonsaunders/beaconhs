# @beaconhs/plugin-webhook-out

Generic outbound-webhook plugin for BeaconHS. POSTs every subscribed
event to a tenant-configured URL with an HMAC SHA-256 signature in the
`X-BeaconHS-Signature` header.

## Verifying signatures (receiver-side)

```js
// Node 20+
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headerValue, secret) {
  const [algo, hex] = headerValue.split("=");
  if (algo !== "sha256") return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Receivers should reject events where the timestamp (`occurredAt`) is
older than a few minutes to prevent replay.

## Payload shape

```json
{
  "eventId": "uuid",
  "type": "incident.reported",
  "category": "incident",
  "tenantId": "uuid",
  "actorId": "uuid|null",
  "occurredAt": "2026-05-19T17:32:11.123Z",
  "payload": { /* event-specific */ }
}
```

## Configuration

Settings live on `tenant_plugins.settings`:

```json
{
  "webhooks": {
    "primary": {
      "url": "https://customer.example/webhook/beaconhs"
    }
  }
}
```

The shared secret is stored in `tenant_plugin_secrets` under the key
`webhooks.primary.secret`. The plugin runner pulls it from there at
invocation time (never via `process.env` — plugins have no access to
environment variables).
