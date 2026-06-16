import { redirect } from 'next/navigation'

// Assessment types are instant-created from the list "New" button and edited on
// their detail page (name, passing score, questions) — no separate create form.
// This legacy route only redirects.
export default function NewAssessmentTypeRedirect() {
  redirect('/training/assessments/types')
}
