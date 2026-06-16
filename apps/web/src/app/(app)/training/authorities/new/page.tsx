import { redirect } from 'next/navigation'

// Skill authorities are instant-created from the list "New" button and edited
// on their detail page (name, code, jurisdiction, skill types) — no separate
// create form. This legacy route only redirects.
export default function NewAuthorityRedirect() {
  redirect('/training/authorities')
}
