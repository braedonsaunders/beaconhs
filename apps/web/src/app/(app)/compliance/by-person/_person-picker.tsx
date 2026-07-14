'use client'

// Person chooser for the By-person tab. Selecting a person soft-navigates
// (router.push) to ?person=<id> — a client-side transition, NOT a full
// document load, so the boot splash never replays. Uses SearchSelect (typeahead
// + mobile sheet) instead of a 2000-option native <select>.

import { useRouter } from 'next/navigation'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export function PersonPicker({ selected }: { selected: string }) {
  const router = useRouter()
  return (
    <div className="w-full sm:max-w-md">
      <label className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        Person
      </label>
      <RemoteSearchSelect
        lookup="compliance-by-person"
        value={selected}
        onChange={(id) =>
          router.push(id ? `/compliance/by-person?person=${id}` : '/compliance/by-person')
        }
        placeholder="Select a person…"
        searchPlaceholder="Search people…"
        sheetTitle="Select person"
        ariaLabel="Person"
        clearable
        emptyLabel="— None —"
      />
    </div>
  )
}
