// Documents sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Documents / Books / Management reviews) + a manager-only
// Manage pill; the admin taxonomies (types and categories) live in
// /documents/manage and render the admin face of the nav.

import { ModuleNav } from '@/components/module-admin/module-nav'

type NavKey = 'documents' | 'books' | 'management-reviews' | 'types' | 'categories'

export function DocumentsSubNav({ active }: { active: NavKey }) {
  return <ModuleNav moduleKey="documents" active={active} />
}
