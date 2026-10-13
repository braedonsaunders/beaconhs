'use client'

import { useRouter } from 'next/navigation'
import { useGeneratedTranslations } from '@/i18n/generated'
import { RemoteSearchSelect } from '@/components/remote-search-select'

/** Step one of an other-PPE inspection: the type decides the checklist. */
export function OtherPpeTypePicker({ basePath }: { basePath: string }) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  return (
    <RemoteSearchSelect
      lookup="ppe-other-inspection-types"
      value=""
      onChange={(typeId) => {
        if (!typeId) return
        router.replace(`${basePath}?drawer=inspect-other&otherType=${encodeURIComponent(typeId)}`, {
          scroll: false,
        })
      }}
      placeholder={tGenerated('m_0ee40d4270583b')}
      searchPlaceholder={tGenerated('m_116a037295ed53')}
      emptyLabel={tGenerated('m_1acb95884097cd')}
      ariaLabel="PPE type"
    />
  )
}
