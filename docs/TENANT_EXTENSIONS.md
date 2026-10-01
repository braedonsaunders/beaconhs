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

## Install

1. Build the private plugin separately against the host contract. Its artifact
   must bundle all its runtime code; host SDK imports must be types only.
2. Mount the artifact directory read-only into **every web replica**, at the same
   absolute path. Do not add private artifacts to the base image or public repo.
3. Set `TENANT_PLUGIN_INSTALLATIONS` to a JSON array. Each entry contains a tenant
   UUID, matching `pluginId`, and absolute `modulePath` to its `.cjs` artifact.
4. Restart or roll the web service during the approved deployment window.
5. Verify the action appears for an editor in the installed tenant, stays absent
   for a reader and other tenants, executes successfully, and writes an audit row.

The default `[]` loads no modules and renders no extension actions. A missing or
invalid artifact produces an extension-unavailable notice without stopping native
editing. Invocation fails closed. Installation configuration is not editable by
tenant users. Artifact updates require a web rollout because Node caches modules.
