import { redirect } from 'next/navigation'
import { pickString } from '@/lib/list-params'
import { startInspection } from '../_actions'

export const dynamic = 'force-dynamic'

// The full-page "new inspection" form is gone — picking a type now happens in
// the records-list flyout, and everything else is captured inline on the record
// itself. A `?typeId=` deep link (e.g. the "Start inspection" button on a type)
// creates straight away; otherwise we just open the flyout.
export default async function NewInspectionRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const typeId = pickString(sp.typeId)
  if (typeId) {
    const fd = new FormData()
    fd.set('typeId', typeId)
    await startInspection(fd) // creates the record, then redirects to it
  }
  redirect('/inspections/records?drawer=new')
}
