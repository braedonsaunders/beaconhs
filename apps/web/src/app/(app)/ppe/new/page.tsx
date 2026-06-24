import { redirect } from 'next/navigation'

// The full-page "new PPE item" form was replaced by the Issue PPE flyout on the
// register. Keep this route as a redirect so old links/bookmarks still work.
export default function NewPpeRedirect() {
  redirect('/ppe?drawer=issue')
}
