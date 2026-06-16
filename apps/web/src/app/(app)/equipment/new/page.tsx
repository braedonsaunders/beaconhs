import { redirect } from 'next/navigation'

// Equipment is instant-created from the list "Add equipment" button (lands in
// the detail Edit tab as a draft) and edited there — no separate create form.
// This legacy route only redirects.
export default function NewEquipmentRedirect() {
  redirect('/equipment')
}
