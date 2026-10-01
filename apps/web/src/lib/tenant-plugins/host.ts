import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import * as schema from '@beaconhs/db/schema'
import * as orm from 'drizzle-orm'
import * as egress from '@beaconhs/sync/egress'
import { unsealSecret } from '@beaconhs/crypto'
import { recordAuditInTransaction } from '@/lib/audit'
import type {
  InstalledPluginAction,
  PluginActionContext,
  TenantPlugin,
  TenantPluginSdk,
} from './types'

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const installationsSchema = z
  .array(
    z
      .object({ tenantId: z.uuid(), pluginId: slug, modulePath: z.string().refine(isAbsolute) })
      .strict(),
  )
  .max(100)
const actionSchema = z
  .object({
    id: slug,
    label: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    disabledReason: z.string().max(1000).optional(),
    confirm: z.string().max(1000).optional(),
    fields: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
            label: z.string().min(1).max(100),
            value: z.string().max(255).optional(),
            options: z
              .array(
                z
                  .object({ value: z.string().min(1).max(255), label: z.string().min(1).max(200) })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict()
const runtimeRequire = createRequire(`${process.cwd()}/package.json`)
const sdk: TenantPluginSdk = {
  schema,
  orm,
  egress: { ...egress, unsealSecret },
  recordAuditInTransaction,
}

/** Tenant selection happens before loading any private artifact. Paths are operator config only. */
export function tenantInstallations(
  tenantId: string,
  config = process.env.TENANT_PLUGIN_INSTALLATIONS ?? '[]',
) {
  const all = installationsSchema.parse(JSON.parse(config) as unknown)
  const ids = new Set<string>()
  for (const installation of all) {
    const key = `${installation.tenantId}:${installation.pluginId}`
    if (ids.has(key)) throw new Error('Duplicate tenant plugin installation.')
    ids.add(key)
  }
  return all.filter((installation) => installation.tenantId === tenantId)
}
function loadPlugin(installation: ReturnType<typeof tenantInstallations>[number]): TenantPlugin {
  const loadedModule: unknown = runtimeRequire(installation.modulePath)
  if (
    !loadedModule ||
    typeof loadedModule !== 'object' ||
    !('createPlugin' in loadedModule) ||
    typeof loadedModule.createPlugin !== 'function'
  )
    throw new Error('Invalid tenant plugin module.')
  const plugin = loadedModule.createPlugin(sdk) as TenantPlugin
  if (
    plugin.apiVersion !== 1 ||
    plugin.id !== installation.pluginId ||
    typeof plugin.actions !== 'function' ||
    typeof plugin.execute !== 'function'
  )
    throw new Error('Invalid tenant plugin contract.')
  return plugin
}
function validateActions(actions: unknown) {
  const parsed = z.array(actionSchema).max(20).parse(actions)
  const ids = new Set<string>()
  for (const action of parsed) {
    if (ids.has(action.id)) throw new Error('Duplicate tenant plugin action.')
    ids.add(action.id)
    const fields = new Set<string>()
    for (const field of action.fields ?? []) {
      if (
        fields.has(field.name) ||
        new Set(field.options.map((option) => option.value)).size !== field.options.length
      )
        throw new Error('Duplicate tenant plugin field or option.')
      fields.add(field.name)
      if (field.value && !field.options.some((option) => option.value === field.value))
        throw new Error('Invalid tenant plugin default.')
    }
  }
  return parsed
}
export async function loadTenantPluginActions(
  context: PluginActionContext,
): Promise<{ actions: InstalledPluginAction[]; unavailable: boolean }> {
  const actions: InstalledPluginAction[] = []
  let unavailable = false
  try {
    for (const installation of tenantInstallations(context.ctx.tenantId)) {
      try {
        const pluginActions = validateActions(await loadPlugin(installation).actions(context))
        actions.push(
          ...pluginActions.map((action) => ({ ...action, pluginId: installation.pluginId })),
        )
      } catch {
        console.error('[tenant-plugin] Action discovery failed', {
          tenantId: context.ctx.tenantId,
          pluginId: installation.pluginId,
          surface: context.surface,
        })
        unavailable = true
      }
    }
  } catch {
    console.error('[tenant-plugin] Invalid installation configuration')
    unavailable = true
  }
  return { actions, unavailable }
}
/** Caller must authorize its surface/target before entering this host on every invocation. */
export async function executeTenantPluginAction(
  context: PluginActionContext,
  pluginId: string,
  actionId: string,
  fields: unknown,
): Promise<{ message: string }> {
  const installation = tenantInstallations(context.ctx.tenantId).find(
    (item) => item.pluginId === slug.parse(pluginId),
  )
  if (!installation) throw new Error('Tenant extension is not installed.')
  const plugin = loadPlugin(installation)
  const action = validateActions(await plugin.actions(context)).find((item) => item.id === actionId)
  if (!action || action.disabledReason) throw new Error('Tenant extension action is unavailable.')
  const values = z.record(z.string(), z.string().max(255)).parse(fields)
  const expected = action.fields ?? []
  if (Object.keys(values).some((key) => !expected.some((field) => field.name === key)))
    throw new Error('Unknown extension field.')
  for (const field of expected) {
    if (!field.options.some((option) => option.value === values[field.name]))
      throw new Error(`Choose ${field.label}.`)
  }
  const result = await plugin.execute(context, actionId, values)
  return z
    .object({ message: z.string().min(1).max(2000) })
    .strict()
    .parse(result)
}
