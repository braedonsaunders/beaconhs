'use client'

import { useActionState, useMemo } from 'react'
import { Alert, AlertDescription, Button, Input, Label, Select } from '@beaconhs/ui'
import { updateProfile } from './actions'

export function ProfileForm({
  name,
  email,
  timezone,
  locale,
}: {
  name: string
  email: string
  timezone: string
  locale: string
}) {
  const [state, action, pending] = useActionState(updateProfile, null)

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
        <Label htmlFor="acc-name">Name</Label>
        <Input id="acc-name" name="name" defaultValue={name} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc-email">Email</Label>
        <Input id="acc-email" value={email} disabled readOnly />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Email changes are handled by an administrator.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-tz">Time zone</Label>
          <Select id="acc-tz" name="timezone" defaultValue={timezone} searchable>
            {timezones.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Used for dates and greetings across the app.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-locale">Language</Label>
          <Select id="acc-locale" name="locale" defaultValue={locale}>
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
          </Select>
        </div>
      </div>

      {state?.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state?.ok ? (
        <Alert variant="success">
          <AlertDescription>Profile updated.</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
