import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Kiosk page — shared-tablet sign-in/sign-out for jobsites.
// Sits OUTSIDE the (app) route group so the AppShell doesn't wrap it (no nav,
// no logged-in user, no tenant cookie). Authenticates by tenant slug in
// ?t=<slug> + a tenant-configured kiosk PIN.

import { db, type Database } from '@beaconhs/db'
import { NextIntlClientProvider } from 'next-intl'
import { resolveLocalePreferences } from '@beaconhs/i18n'
import { KioskClient } from './kiosk-client'
import { resolveActiveTenant } from '@/lib/active-tenant'
import { getMessagesForLocale } from '@/i18n/messages'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1e4f60f7998491') }
}

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const slug = typeof sp.t === 'string' ? sp.t : Array.isArray(sp.t) ? sp.t[0] : undefined

  if (!slug) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">
            <GeneratedText id="m_0d76a697d15a10" />
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            <GeneratedText id="m_0ff02b3f134e7c" />
            <GeneratedValue value={' '} />
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-teal-400">
              ?t=&lt;tenant-slug&gt;
            </code>
            .
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <GeneratedText id="m_11b853beb9786c" />{' '}
            <code className="font-mono text-slate-300">/kiosk?t=acme-construction</code>
          </p>
        </div>
      </div>
    )
  }

  // The kiosk is unauthenticated. Resolve only non-sensitive tenant chrome here;
  // roster/site/crew data is loaded by a PIN-verified server action.
  const tenant = await db.transaction((tx) =>
    resolveActiveTenant(tx as unknown as Database, { slug }),
  )

  if (!tenant) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">
            <GeneratedText id="m_153d9d4a9a380d" />
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            <GeneratedText id="m_1eac47d106fa36" />
          </p>
        </div>
      </div>
    )
  }
  if (!tenant.kioskPin) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">
            <GeneratedText id="m_1f8f74f76eb6b5" />
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            <GeneratedText id="m_0474fd49a7de85" />
          </p>
        </div>
      </div>
    )
  }

  const { locale } = resolveLocalePreferences({
    defaultLocale: tenant.defaultLanguage,
    enabledLocales: tenant.enabledLanguages,
  })
  const messages = getMessagesForLocale(locale)
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Toronto">
      <KioskClient tenantId={tenant.id} tenantName={tenant.name} />
    </NextIntlClientProvider>
  )
}
