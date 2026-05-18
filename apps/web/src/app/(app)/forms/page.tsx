import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { desc } from 'drizzle-orm'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import { formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Forms' }

export default async function FormsPage() {
  const ctx = await requireRequestContext()
  if (ctx.isSuperAdmin) {
    return (
      <EmptyState
        icon={<ClipboardCheck />}
        title="Pick a tenant"
        description="Super-admins must impersonate a tenant to view its forms."
      />
    )
  }

  const templates = await ctx.db((tx) =>
    tx.select().from(formTemplates).orderBy(desc(formTemplates.updatedAt)).limit(100),
  )

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Forms</h1>
          <p className="text-sm text-slate-500">
            Templates, assignments, and submissions. Designer launches in Phase 1.
          </p>
        </div>
        <Link href="/forms/templates/new">
          <Button>New template</Button>
        </Link>
      </header>

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No form templates yet"
          description="Build your first template — inspection, JSHA, toolbox talk, anything."
          action={
            <Link href="/forms/templates/new">
              <Button>Create template</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-4">
              <div className="space-y-1">
                <Link href={`/forms/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{t.category ?? 'general'}</span>
                  <Badge variant={t.status === 'published' ? 'success' : 'secondary'}>
                    {t.status}
                  </Badge>
                </div>
              </div>
              <Link href={`/forms/templates/${t.id}`}>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
