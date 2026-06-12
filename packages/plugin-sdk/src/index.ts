import { z } from 'zod'

// --- Capabilities ---------------------------------------------------------

export const CAPABILITIES = [
  'sync.in',
  'sync.out',
  'ui.panel',
  'field.type',
  'report.type',
] as const
export type Capability = (typeof CAPABILITIES)[number]

// --- Hook events ----------------------------------------------------------

export const HOOK_EVENTS = [
  // Lifecycle
  'plugin.enabled',
  'plugin.disabled',
  // Scheduling
  'cron.hourly',
  'cron.daily',
  'cron.weekly',
  // Domain events
  'incident.created',
  'incident.updated',
  'incident.closed',
  'form.response.submitted',
  'form.response.signed',
  'training.record.created',
  'training.cert.expiring',
  'training.cert.expired',
  'ca.created',
  'ca.closed',
  'loneworker.session.started',
  'loneworker.checkin.missed',
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

// --- UI panel slots -------------------------------------------------------

export const UI_SLOTS = [
  'incident.detail.sidebar',
  'incident.detail.tab',
  'form.response.detail.sidebar',
  'equipment.detail.tab',
  'person.detail.tab',
  'dashboard.widget',
  'settings.tab',
] as const
export type UiSlot = (typeof UI_SLOTS)[number]

// --- Plugin context (the surface a plugin can call into) -----------------

export type PluginContext = {
  tenantId: string
  pluginKey: string
  config: Record<string, unknown>
  secrets: Record<string, string>
  logger: {
    info: (msg: string, ctx?: unknown) => void
    error: (msg: string, ctx?: unknown) => void
  }
  // Sandboxed DB access. In v1 this is the real DB scoped to the tenant.
  // In v2 (third-party plugins), it'll be a curated capability set.
  api: {
    forms: {
      submitResponse: (input: {
        templateKey: string
        data: Record<string, unknown>
        siteOrgUnitId?: string
      }) => Promise<{ id: string }>
    }
    people: {
      upsertByEmployeeNo: (input: {
        employeeNo: string
        firstName: string
        lastName: string
        email?: string
        departmentName?: string
        tradeName?: string
      }) => Promise<{ id: string }>
    }
    incidents: { list: (filter?: { status?: string }) => Promise<Array<{ id: string }>> }
    httpFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  }
}

// --- Plugin definition ---------------------------------------------------

export type PluginDefinition<TConfig, TSecrets> = {
  key: string
  name: string
  description?: string
  version: string
  capabilities: Capability[]
  config: z.ZodSchema<TConfig>
  secrets?: z.ZodSchema<TSecrets>
  hooks?: Partial<{
    [E in HookEvent]: (
      ctx: PluginContext & { config: TConfig; secrets: TSecrets },
      event: unknown,
    ) => Promise<void> | void
  }>
  fieldTypes?: PluginFieldType[]
  uiPanels?: PluginUiPanel[]
}

export type PluginFieldType = {
  type: string // unique key like 'netsuite_customer'
  label: string
  category:
    | 'standard'
    | 'choice'
    | 'scoring'
    | 'picker'
    | 'media'
    | 'identity'
    | 'computed'
    | 'display'
  // URL or import path to the React component used in the form designer + renderer.
  // For first-party plugins, this is a static export from the plugin package.
  componentImport: string
  serverValidatorImport?: string
}

export type PluginUiPanel = {
  slot: UiSlot
  componentImport: string
  title?: string
}

export function definePlugin<TConfig, TSecrets = unknown>(
  def: PluginDefinition<TConfig, TSecrets>,
): PluginDefinition<TConfig, TSecrets> {
  return def
}

// Helper to type-assert a plugin's manifest JSON saved in the DB.
export type PluginManifest = Pick<
  PluginDefinition<unknown, unknown>,
  'key' | 'name' | 'version' | 'capabilities'
> & {
  uiPanels?: { slot: UiSlot; title?: string; componentImport: string }[]
  fieldTypes?: { type: string; label: string; category: string; componentImport: string }[]
}
