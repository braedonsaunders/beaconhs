'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

// Person chooser for the By-person tab. Selecting a person soft-navigates
// (router.push) to ?person=<id> — a client-side transition, NOT a full
// document load, so the boot splash never replays. Uses SearchSelect (typeahead
// + mobile sheet) instead of a 2000-option native <select>.

import { useRouter } from 'next/navigation'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export function PersonPicker({ selected }: { selected: string }) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  return (
    <div className="w-full sm:max-w-md">
      <label className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedText id="m_12e926c9216094" />
      </label>
      <RemoteSearchSelect
        lookup="compliance-by-person"
        value={selected}
        onChange={(id) =>
          router.push(id ? `/compliance/by-person?person=${id}` : '/compliance/by-person')
        }
        placeholder={tGenerated('m_0be39d3a196b5b')}
        searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
        sheetTitle="Select person"
        ariaLabel="Person"
        clearable
        emptyLabel={tGenerated('m_0dd5f8a31ce3e1')}
      />
    </div>
  )
}
