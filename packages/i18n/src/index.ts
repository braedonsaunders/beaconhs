export const SUPPORTED_LOCALES = ['en', 'fr', 'es'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'en'

export const LOCALE_OPTIONS = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'fr', label: 'French', nativeLabel: 'Français' },
  { value: 'es', label: 'Spanish', nativeLabel: 'Español' },
] as const satisfies readonly {
  value: AppLocale
  label: string
  nativeLabel: string
}[]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function parseAppLocale(value: unknown): AppLocale | null {
  return isAppLocale(value) ? value : null
}

/** Best-effort locale negotiation for unauthenticated/public requests. */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return DEFAULT_LOCALE
  const requested = header
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith('q='))
      const parsedQuality = quality ? Number(quality.slice(2)) : 1
      return {
        locale: parseAppLocale(tag.toLowerCase().split('-')[0]),
        quality: Number.isFinite(parsedQuality) ? Math.max(0, Math.min(1, parsedQuality)) : 0,
      }
    })
    .filter(
      (entry): entry is { locale: AppLocale; quality: number } =>
        entry.locale !== null && entry.quality > 0,
    )
    .sort((a, b) => b.quality - a.quality)
  return requested[0]?.locale ?? DEFAULT_LOCALE
}

/**
 * Return a stable, de-duplicated supported-locale list. Unknown persisted values
 * are deliberately discarded so stale configuration can never reach Intl or a
 * message-catalogue import.
 */
export function normalizeEnabledLocales(values: readonly unknown[]): AppLocale[] {
  const selected = new Set(values.filter(isAppLocale))
  return SUPPORTED_LOCALES.filter((locale) => selected.has(locale))
}

export function normalizeLocalePolicy(args: {
  defaultLocale: unknown
  enabledLocales: readonly unknown[]
}): { defaultLocale: AppLocale; enabledLocales: AppLocale[] } {
  const requestedDefault = parseAppLocale(args.defaultLocale) ?? DEFAULT_LOCALE
  const enabledLocales = normalizeEnabledLocales([...args.enabledLocales, requestedDefault])
  return { defaultLocale: requestedDefault, enabledLocales }
}

/** Resolve `tenant-user override -> tenant default -> platform default`. */
export function resolveLocale(args: {
  defaultLocale: unknown
  enabledLocales: readonly unknown[]
  userLocale?: unknown
}): AppLocale {
  const policy = normalizeLocalePolicy(args)
  const userLocale = parseAppLocale(args.userLocale)
  return userLocale && policy.enabledLocales.includes(userLocale)
    ? userLocale
    : policy.defaultLocale
}

/** Canonical locale state stored on request and worker contexts. */
export function resolveLocalePreferences(args: {
  defaultLocale: unknown
  enabledLocales: readonly unknown[]
  userLocale?: unknown
}): {
  locale: AppLocale
  defaultLocale: AppLocale
  enabledLocales: AppLocale[]
  localeOverride: AppLocale | null
} {
  const policy = normalizeLocalePolicy(args)
  const requestedOverride = parseAppLocale(args.userLocale)
  const localeOverride =
    requestedOverride && policy.enabledLocales.includes(requestedOverride)
      ? requestedOverride
      : null
  return {
    ...policy,
    locale: localeOverride ?? policy.defaultLocale,
    localeOverride,
  }
}

export type LocalizedText = Readonly<Partial<Record<AppLocale, string>>> &
  Readonly<Record<string, string | undefined>>

/**
 * Resolve tenant-authored multilingual content without losing older English
 * content. The tenant default is preferred after the user's effective locale,
 * followed by English and finally the first non-empty supported translation.
 */
export function localizeText(
  value: LocalizedText | string | null | undefined,
  locale: AppLocale,
  fallback: string,
  tenantDefault: AppLocale = DEFAULT_LOCALE,
): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (!value) return fallback

  const candidates = [locale, tenantDefault, DEFAULT_LOCALE, ...SUPPORTED_LOCALES]
  for (const candidate of candidates) {
    const translated = value[candidate]
    if (typeof translated === 'string' && translated.trim()) return translated
  }
  return fallback
}
