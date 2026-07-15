import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// Public Equipment Station kiosk — mounted-tablet check in/out with a USB scan
// gun. Lives OUTSIDE the (app) route group (no AppShell, no login). Authenticated
// by tenant slug in ?t=<slug> + the tenant's equipment-station PIN (verified
// server-side on every action). Mirrors the people sign-in/out kiosk at /kiosk.

import { db, type Database } from '@beaconhs/db'
import { NextIntlClientProvider } from 'next-intl'
import { resolveLocalePreferences } from '@beaconhs/i18n'
import { EquipmentKioskClient } from './kiosk-client'
import { resolveActiveTenant } from '@/lib/active-tenant'
import { getMessagesForLocale } from '@/i18n/messages'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0f29eedb297360') }
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-2xl bg-slate-900 p-8 text-center">
        <h1 className="text-xl font-semibold">
          <GeneratedValue value={title} />
        </h1>
        <div className="mt-2 text-sm text-slate-400">
          <GeneratedValue value={children} />
        </div>
      </div>
    </div>
  )
}

export default async function EquipmentKioskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const slug = typeof sp.t === 'string' ? sp.t : Array.isArray(sp.t) ? sp.t[0] : undefined

  if (!slug) {
    return (
      <Notice title={tGenerated('m_0d76a697d15a10')}>
        <GeneratedText id="m_0ff02b3f134e7c" />
        <GeneratedValue value={' '} />
        <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-amber-400">
          ?t=&lt;tenant-slug&gt;
        </code>
        .
      </Notice>
    )
  }

  const tenant = await db.transaction((tx) =>
    resolveActiveTenant(tx as unknown as Database, { slug }),
  )

  if (!tenant) {
    return (
      <Notice title={tGenerated('m_153d9d4a9a380d')}>
        <GeneratedText id="m_1eac47d106fa36" />
      </Notice>
    )
  }
  const { locale } = resolveLocalePreferences({
    defaultLocale: tenant.defaultLanguage,
    enabledLocales: tenant.enabledLanguages,
  })
  const messages = getMessagesForLocale(locale)
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Toronto">
      <EquipmentKioskClient tenantId={tenant.id} tenantName={tenant.name} />
    </NextIntlClientProvider>
  )
}
