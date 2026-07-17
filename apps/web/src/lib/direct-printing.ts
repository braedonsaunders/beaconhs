import 'server-only'

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { sealSecret, unsealSecret, type SealedSecret } from '@beaconhs/crypto'
import { secureFetch } from '@beaconhs/sync/egress'
import type { RequestContext } from '@beaconhs/tenant'
import type { PrintProvider } from '@beaconhs/design-studio'
import { buildCardPressoPrintXml } from './cardpresso-xml'

export const DIRECT_PRINT_PROVIDERS = [
  'cardpresso-wps',
  'zebra-browser-print',
  'evolis-sdk',
  'hid-fargo-sdk',
] as const satisfies readonly PrintProvider[]

export type DirectPrintProvider = (typeof DIRECT_PRINT_PROVIDERS)[number]

export const DIRECT_PRINT_PROVIDER_LABELS: Record<DirectPrintProvider, string> = {
  'cardpresso-wps': 'cardPresso Web Print Server',
  'zebra-browser-print': 'Zebra Browser Print bridge',
  'evolis-sdk': 'Evolis SDK bridge',
  'hid-fargo-sdk': 'HID FARGO SDK bridge',
}

type RawBridgeConfig = {
  enabled?: boolean
  url?: string
  printer?: string
  token?: SealedSecret
}

type RawCardPressoConfig = {
  enabled?: boolean
  url?: string
  basicAuthUsername?: string
  basicAuthPassword?: SealedSecret
  loginName?: string
  loginPassword?: SealedSecret
  cardDocument?: string
  printer?: string
  frontItemId?: string
  backItemId?: string
}

type RawPrintingSettings = {
  providers?: Partial<Record<DirectPrintProvider, RawBridgeConfig | RawCardPressoConfig>>
}

export type DirectPrintProviderSettings = {
  provider: DirectPrintProvider
  label: string
  enabled: boolean
  url: string
  printer: string
  hasToken: boolean
  basicAuthUsername: string
  hasBasicAuthPassword: boolean
  loginName: string
  hasLoginPassword: boolean
  cardDocument: string
  frontItemId: string
  backItemId: string
  configured: boolean
}

export type SaveDirectPrintProviderInput = {
  provider: DirectPrintProvider
  enabled: boolean
  url: string
  printer: string
  token?: string
  clearToken?: boolean
  basicAuthUsername?: string
  basicAuthPassword?: string
  clearBasicAuthPassword?: boolean
  loginName?: string
  loginPassword?: string
  clearLoginPassword?: boolean
  cardDocument?: string
  frontItemId?: string
  backItemId?: string
}

export type DirectPrintResult = {
  provider: DirectPrintProvider
  jobId: string | null
  status: string | null
  message: string | null
}

export function isDirectPrintProvider(value: unknown): value is DirectPrintProvider {
  return DIRECT_PRINT_PROVIDERS.includes(value as DirectPrintProvider)
}

function printingFromSettings(settings: unknown): RawPrintingSettings {
  if (!settings || typeof settings !== 'object') return {}
  const printing = (settings as Record<string, unknown>).printing
  return printing && typeof printing === 'object' ? (printing as RawPrintingSettings) : {}
}

async function readTenantPrinting(tenantId: string): Promise<RawPrintingSettings> {
  return withSuperAdmin(db, async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return printingFromSettings(tenant?.settings)
  })
}

function validPublicHttpsUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Printer service URL must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Printer service URL must use HTTPS and cannot contain credentials.')
  }
  url.hash = ''
  return url.toString()
}

function providerSettings(
  printing: RawPrintingSettings,
  provider: DirectPrintProvider,
): DirectPrintProviderSettings {
  const raw = printing.providers?.[provider] ?? {}
  if (provider === 'cardpresso-wps') {
    const card = raw as RawCardPressoConfig
    const configured = Boolean(
      card.enabled &&
      card.url &&
      card.basicAuthPassword &&
      card.loginName &&
      card.loginPassword &&
      card.cardDocument &&
      card.printer,
    )
    return {
      provider,
      label: DIRECT_PRINT_PROVIDER_LABELS[provider],
      enabled: card.enabled === true,
      url: card.url ?? '',
      printer: card.printer ?? '',
      hasToken: false,
      basicAuthUsername: card.basicAuthUsername ?? 'wps',
      hasBasicAuthPassword: Boolean(card.basicAuthPassword),
      loginName: card.loginName ?? '',
      hasLoginPassword: Boolean(card.loginPassword),
      cardDocument: card.cardDocument ?? '',
      frontItemId: card.frontItemId ?? 'BEACON_FRONT',
      backItemId: card.backItemId ?? 'BEACON_BACK',
      configured,
    }
  }

  const bridge = raw as RawBridgeConfig
  return {
    provider,
    label: DIRECT_PRINT_PROVIDER_LABELS[provider],
    enabled: bridge.enabled === true,
    url: bridge.url ?? '',
    printer: bridge.printer ?? '',
    hasToken: Boolean(bridge.token),
    basicAuthUsername: '',
    hasBasicAuthPassword: false,
    loginName: '',
    hasLoginPassword: false,
    cardDocument: '',
    frontItemId: '',
    backItemId: '',
    configured: Boolean(bridge.enabled && bridge.url && bridge.printer && bridge.token),
  }
}

export async function getTenantPrintingSettings(
  ctx: Pick<RequestContext, 'tenantId'>,
): Promise<DirectPrintProviderSettings[]> {
  const printing = await readTenantPrinting(ctx.tenantId)
  return DIRECT_PRINT_PROVIDERS.map((provider) => providerSettings(printing, provider))
}

export async function getConfiguredDirectPrintProviders(
  ctx: Pick<RequestContext, 'tenantId'>,
): Promise<DirectPrintProvider[]> {
  return (await getTenantPrintingSettings(ctx))
    .filter((provider) => provider.configured)
    .map((provider) => provider.provider)
}

export async function saveTenantPrintingProvider(
  ctx: Pick<RequestContext, 'tenantId'>,
  input: SaveDirectPrintProviderInput,
): Promise<void> {
  const url = input.url.trim() ? validPublicHttpsUrl(input.url.trim()) : ''
  const printer = input.printer.trim()
  if (input.enabled && (!url || !printer)) {
    throw new Error('Enabled printer providers require a service URL and printer name.')
  }

  await withSuperAdmin(db, async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
      .for('update')
    if (!tenant) throw new Error('Workspace not found.')
    const settings = (tenant.settings as Record<string, unknown> | null) ?? {}
    const printing = printingFromSettings(settings)
    const providers = { ...(printing.providers ?? {}) }
    const previous = providers[input.provider] ?? {}

    if (input.provider === 'cardpresso-wps') {
      const prev = previous as RawCardPressoConfig
      const next: RawCardPressoConfig = {
        enabled: input.enabled,
        url: url || undefined,
        basicAuthUsername: input.basicAuthUsername?.trim() || 'wps',
        basicAuthPassword: input.clearBasicAuthPassword ? undefined : prev.basicAuthPassword,
        loginName: input.loginName?.trim() || undefined,
        loginPassword: input.clearLoginPassword ? undefined : prev.loginPassword,
        cardDocument: input.cardDocument?.trim() || undefined,
        printer: printer || undefined,
        frontItemId: input.frontItemId?.trim() || 'BEACON_FRONT',
        backItemId: input.backItemId?.trim() || 'BEACON_BACK',
      }
      if (input.basicAuthPassword?.trim()) {
        next.basicAuthPassword = sealSecret(input.basicAuthPassword.trim())
      }
      if (input.loginPassword?.trim()) {
        next.loginPassword = sealSecret(input.loginPassword.trim())
      }
      if (
        input.enabled &&
        (!next.basicAuthPassword || !next.loginName || !next.loginPassword || !next.cardDocument)
      ) {
        throw new Error('Complete every required cardPresso field before enabling it.')
      }
      providers[input.provider] = next
    } else {
      const prev = previous as RawBridgeConfig
      const next: RawBridgeConfig = {
        enabled: input.enabled,
        url: url || undefined,
        printer: printer || undefined,
        token: input.clearToken ? undefined : prev.token,
      }
      if (input.token?.trim()) next.token = sealSecret(input.token.trim())
      if (input.enabled && !next.token) {
        throw new Error('Enter a bridge access token before enabling this printer provider.')
      }
      providers[input.provider] = next
    }

    await tx
      .update(tenants)
      .set({ settings: { ...settings, printing: { providers } } })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

function requiredSecret(secret: SealedSecret | undefined, label: string): string {
  const value = secret ? unsealSecret(secret) : null
  if (!value) throw new Error(`${label} is missing or cannot be decrypted.`)
  return value
}

function tag(body: string, name: string): string | null {
  const match = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]{0,4000})</${name}>`, 'i'))
  return match?.[1]?.trim() || null
}

async function sendCardPresso(
  config: RawCardPressoConfig,
  images: { front: Buffer; back?: Buffer | null },
): Promise<Omit<DirectPrintResult, 'provider'>> {
  if (
    !config.enabled ||
    !config.url ||
    !config.loginName ||
    !config.cardDocument ||
    !config.printer
  ) {
    throw new Error('cardPresso direct printing is not configured for this workspace.')
  }
  const basicPassword = requiredSecret(config.basicAuthPassword, 'cardPresso basic-auth password')
  const loginPassword = requiredSecret(config.loginPassword, 'cardPresso login password')
  const body = buildCardPressoPrintXml(
    {
      loginName: config.loginName,
      loginPassword,
      cardDocument: config.cardDocument,
      printer: config.printer,
      frontItemId: config.frontItemId || 'BEACON_FRONT',
      backItemId: config.backItemId || 'BEACON_BACK',
    },
    images,
  )
  const authorization = Buffer.from(
    `${config.basicAuthUsername || 'wps'}:${basicPassword}`,
    'utf8',
  ).toString('base64')
  const response = await secureFetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${authorization}`,
      'content-type': 'application/xml; charset=utf-8',
      accept: 'application/xml, text/xml',
    },
    body,
    timeoutMs: 30_000,
    maxRequestBytes: 16 * 1024 * 1024,
    maxResponseBytes: 1024 * 1024,
    maxRedirects: 0,
  })
  const responseBody = await response.text()
  const status = responseBody.match(/<jobStatus\b[^>]*\bstatus="([^"]{1,100})"/i)?.[1] ?? null
  const jobId = responseBody.match(/\bprintJobId="([^"]{1,100})"/i)?.[1] ?? null
  const message = tag(responseBody, 'statusMessage')
  if (!response.ok || status?.toUpperCase() === 'ERROR') {
    throw new Error(message || `cardPresso rejected the print job (${response.status}).`)
  }
  return { jobId, status, message }
}

async function sendBridge(
  provider: Exclude<DirectPrintProvider, 'cardpresso-wps'>,
  config: RawBridgeConfig,
  images: { front: Buffer; back?: Buffer | null },
): Promise<Omit<DirectPrintResult, 'provider'>> {
  if (!config.enabled || !config.url || !config.printer) {
    throw new Error(
      `${DIRECT_PRINT_PROVIDER_LABELS[provider]} is not configured for this workspace.`,
    )
  }
  const token = requiredSecret(config.token, `${DIRECT_PRINT_PROVIDER_LABELS[provider]} token`)
  const response = await secureFetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 1,
      provider,
      printer: config.printer,
      media: 'cr80',
      duplex: Boolean(images.back),
      frontPngBase64: images.front.toString('base64'),
      backPngBase64: images.back?.toString('base64') ?? null,
    }),
    timeoutMs: 30_000,
    maxRequestBytes: 16 * 1024 * 1024,
    maxResponseBytes: 1024 * 1024,
    maxRedirects: 0,
  })
  const body = (await response.json().catch(() => null)) as {
    jobId?: unknown
    status?: unknown
    message?: unknown
    error?: unknown
  } | null
  const message = typeof body?.message === 'string' ? body.message : null
  if (!response.ok) {
    throw new Error(
      (typeof body?.error === 'string' && body.error) ||
        message ||
        `The printer bridge rejected the job (${response.status}).`,
    )
  }
  return {
    jobId: typeof body?.jobId === 'string' ? body.jobId : null,
    status: typeof body?.status === 'string' ? body.status : null,
    message,
  }
}

export async function sendDirectPrint(
  ctx: Pick<RequestContext, 'tenantId'>,
  provider: DirectPrintProvider,
  images: { front: Buffer; back?: Buffer | null },
): Promise<DirectPrintResult> {
  const printing = await readTenantPrinting(ctx.tenantId)
  const raw = printing.providers?.[provider]
  if (!raw) throw new Error(`${DIRECT_PRINT_PROVIDER_LABELS[provider]} is not configured.`)
  const result =
    provider === 'cardpresso-wps'
      ? await sendCardPresso(raw as RawCardPressoConfig, images)
      : await sendBridge(provider, raw as RawBridgeConfig, images)
  return { provider, ...result }
}
