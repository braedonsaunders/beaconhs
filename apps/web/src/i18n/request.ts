import { headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { localeFromAcceptLanguage } from '@beaconhs/i18n'
import { getRequestContext } from '@/lib/auth'
import { getMessagesForLocale } from './messages'

export default getRequestConfig(async () => {
  const ctx = await getRequestContext()
  const headerStore = await headers()
  const locale = ctx?.locale ?? localeFromAcceptLanguage(headerStore.get('accept-language'))
  const messages = getMessagesForLocale(locale)

  return {
    locale,
    messages,
    timeZone: ctx?.timezone ?? 'America/Toronto',
  }
})
