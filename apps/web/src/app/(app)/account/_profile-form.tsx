'use client'

import { GeneratedValue } from '@/i18n/generated'

import { useActionState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { AppLocale } from '@beaconhs/i18n'
import { Alert, AlertDescription, Button, Input, Label, Select } from '@beaconhs/ui'
import { updateProfile } from './actions'

export function ProfileForm({
  name,
  email,
  timezone,
  localeOverride,
  defaultLocale,
  enabledLocales,
  canOverrideLocale,
}: {
  name: string
  email: string
  timezone: string
  localeOverride: AppLocale | null
  defaultLocale: AppLocale
  enabledLocales: readonly AppLocale[]
  canOverrideLocale: boolean
}) {
  const [state, action, pending] = useActionState(updateProfile, null)
  const t = useTranslations('Account')
  const common = useTranslations('Common')
  const languages = useTranslations('Languages')

  // Full IANA list (searchable Select). `supportedValuesOf('timeZone')` omits the
  // bare 'UTC' alias in some engines, and could omit the user's stored value, so
  // surface both. Mirrors admin/notifications/_form.tsx.
  const timezones = useMemo<string[]>(() => {
    let z: string[] = []
    try {
      z =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? []
    } catch {
      z = []
    }
    const withUtc = ['UTC', ...z.filter((t) => t !== 'UTC')]
    return withUtc.includes(timezone) ? withUtc : [timezone, ...withUtc]
  }, [timezone])

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="acc-name">
          <GeneratedValue value={t('name')} />
        </Label>
        <Input id="acc-name" name="name" defaultValue={name} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc-email">
          <GeneratedValue value={t('email')} />
        </Label>
        <Input id="acc-email" value={email} disabled readOnly />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue value={t('emailHelp')} />
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-tz">
            <GeneratedValue value={t('timeZone')} />
          </Label>
          <Select id="acc-tz" name="timezone" defaultValue={timezone} searchable>
            {timezones.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={t('timeZoneHelp')} />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-locale">
            <GeneratedValue value={t('language')} />
          </Label>
          <Select
            id="acc-locale"
            name="locale"
            defaultValue={localeOverride ?? ''}
            disabled={!canOverrideLocale}
          >
            <option value="">
              {common('useTenantDefault', { language: languages(defaultLocale) })}
            </option>
            {enabledLocales.map((supportedLocale) => (
              <option key={supportedLocale} value={supportedLocale}>
                {languages(supportedLocale)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={t('languageHelp')} />
          </p>
        </div>
      </div>

      <GeneratedValue
        value={
          state?.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <GeneratedValue value={state.error} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />
      <GeneratedValue
        value={
          state?.ok ? (
            <Alert variant="success">
              <AlertDescription>
                <GeneratedValue value={t('profileUpdated')} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />

      <Button type="submit" disabled={pending}>
        <GeneratedValue value={pending ? common('saving') : t('saveChanges')} />
      </Button>
    </form>
  )
}
