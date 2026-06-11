// Documents sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Documents / Books / Reference / Assignments / Management
// reviews) + a Manage pill; the admin taxonomies (document + reference types and
// categories) live in /documents/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

type NavKey = 'documents' | 'books' | 'reference' | 'management-reviews' | 'types' | 'categories'

export function DocumentsSubNav({ active }: { active: NavKey }) {
  return <ModuleNav moduleKey="documents" active={active} />
}
