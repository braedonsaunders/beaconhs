import { redirect } from 'next/navigation'

// `/equipment/check-in` is an alias for the unified check-in/out dashboard at
// `/equipment/check-out` — both actions share the same screen so users don't
// have to switch tabs to record a return.
export default function CheckInRedirect() {
  redirect('/equipment/check-out')
}
