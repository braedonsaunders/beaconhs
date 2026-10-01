# Tenant extensions

BeaconHS supports trusted, operator-installed server modules. These are executable
server code, with the application's privileges, not a sandbox for code uploaded
by tenant users. Only the deployment operator controls installations.

The public app contains a generic action renderer and host. Extension artifacts
own their button labels, source pickers, business rules, external calls, and
execution. The host does not bundle any company implementation. The `private/`
directory is excluded from Git, the public workspace, and Docker's build context.

## Contract

An independently built CommonJS artifact exports `createPlugin(sdk)`. It returns
`apiVersion: 1`, its installation `id`, `actions(context)`, and
`execute(context, actionId, fields)`. The TypeScript contract is in
`apps/web/src/lib/tenant-plugins/types.ts`.

The SDK supplies schema, Drizzle helpers, secure outbound requests, secret
unsealing, and transaction-bound audit attribution. The context supplies the
current request's tenant-bound database executor, user, surface, and validated
target. Use `context.ctx.db()` for tenant data. Keep business writes and audit
records inside the same transaction. Never retain a request context globally.

Action descriptors contain a stable action ID, label, optional description,
confirmation or disabled reason, and bounded select fields. The host validates
all descriptors and re-loads the current action and allowed field values before
execution. Results contain a user-facing message. Secrets never belong in
these descriptors or messages.

The currently available surface is `equipment.vehicle-log.month`. Its target
contains `driverPersonId`, `equipmentItemId`, and `month` (`YYYY-MM`). The module
checks the same edit access as native row changes and verifies the active driver
and visible vehicle before discovery and again before execution. Readers cannot
invoke these actions. Deleting a whole month still requires equipment management.
The surface works for empty months and does not need an existing log entry.

## Install through the deployment workflow

1. Build the private plugin separately against the host contract. Its artifact
   must bundle all runtime code; host SDK imports must be types only.
2. Provide a private `TENANT_PLUGIN_BUNDLE` repository secret containing JSON:
   `version: 1` and a `plugins` array. Each entry has `tenantId`, `pluginId`,
   the artifact's lowercase hexadecimal `sha256`, and `contentBase64`.
   GitHub secrets limit the complete JSON value to 48 KB. Larger installations
   need a separately authenticated artifact delivery path before deployment.
3. Run the gated main deployment. The preparer validates all IDs, exact fields,
   canonical encoding, and digests before any files or database changes. It
   creates immutable Swarm configs and adds their read-only mounts to web.
   Artifacts are distributed by Swarm, so every web replica receives the same
   private module without putting it in the public repository or image.
4. Verify actions for an editor in the installed tenant, absence for readers
   and other tenants, successful execution, preserved authored rows, and audit.

The workflow derives `TENANT_PLUGIN_INSTALLATIONS` using absolute module paths
under `/opt/beaconhs-tenant-plugins`. Empty configuration loads no modules.
Missing or invalid artifacts show an extension-unavailable notice without
stopping native editing. Invocation fails closed. Tenant users cannot edit
installation configuration. Node caches modules; new artifacts get new digest
paths and are loaded by the next web rollout. Existing Swarm configs are
retained for rollback; active configs must not be pruned.

An operator can also supply `TENANT_PLUGIN_INSTALLATIONS` and read-only mounts
outside this workflow, using the same contract and explicit tenant binding.
