import { redirect } from 'next/navigation'

// Inspections is a native module: admin-defined inspection types (each bundling
// criteria banks) and the pass/fail/N-A records captured against them. The
// records list at /inspections/records is the operational home; this index
// just forwards there so /inspections stays the module's canonical entry point.
export default function InspectionsIndexPage() {
  redirect('/inspections/records')
}
