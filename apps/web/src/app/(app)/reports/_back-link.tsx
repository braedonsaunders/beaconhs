'use client'

import { SmartBackLink } from '@/components/smart-back-link'
import { useGeneratedTranslations } from '@/i18n/generated'

export function ReportsBackLink() {
  const tGenerated = useGeneratedTranslations()
  return (
    <SmartBackLink
      href="/reports"
      label={tGenerated('m_06615b15dc975c')}
      className="w-fit text-sm text-teal-700 hover:underline dark:text-teal-300"
    />
  )
}
