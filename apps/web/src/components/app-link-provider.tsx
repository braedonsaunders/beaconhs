'use client'
import {
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
  type GeneratedMessageKey,
} from '@/i18n/generated'

// Hands next/link to @beaconhs/ui (UiLinkProvider) so ui-package anchors
// (e.g. PageHeader/DetailHeader back-links) navigate client-side instead of
// forcing a full document reload — which would replay the boot splash.

import Link from 'next/link'
import { useCallback } from 'react'
import { UiLinkProvider, UiTextProvider } from '@beaconhs/ui'
import { generatedMessageKey } from '@/i18n/generated-key'

export function AppLinkProvider({ children }: { children: React.ReactNode }) {
  const translate = useGeneratedValueTranslations()
  const translateMessage = useGeneratedTranslations()
  const translateUiText = useCallback(
    (value: string, values?: Readonly<Record<string, unknown>>) =>
      values
        ? translateMessage(generatedMessageKey(value) as GeneratedMessageKey, { ...values })
        : translate(value),
    [translate, translateMessage],
  )
  return (
    <UiTextProvider translate={translateUiText}>
      <UiLinkProvider link={Link}>
        <GeneratedValue value={children} />
      </UiLinkProvider>
    </UiTextProvider>
  )
}
