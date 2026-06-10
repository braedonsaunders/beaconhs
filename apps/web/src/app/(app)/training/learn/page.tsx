import { redirect } from 'next/navigation'

// "My Learning" now lives inside the personal hub (Workspace → My training →
// Courses). This route stays so old links + the player's back button resolve.
export default function LearnIndexRedirect() {
  redirect('/my/training?tab=courses')
}
