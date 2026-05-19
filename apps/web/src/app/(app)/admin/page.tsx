import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Admin' }

const SECTIONS = [
  { href: '/admin/users', title: 'Users & roles', desc: 'Invite users, assign roles, manage scopes.' },
  { href: '/admin/tenants', title: 'Tenants (super-admin)', desc: 'List + view-as every tenant on this deployment.' },
  { href: '/admin/org', title: 'Org hierarchy', desc: 'Customers, projects, sites, areas, crews.' },
  { href: '/admin/settings', title: 'Tenant settings', desc: 'Branding, languages, risk matrix, hierarchy depth.' },
  { href: '/admin/plugins', title: 'Plugins', desc: 'Enable + configure first-party integrations.' },
  { href: '/admin/api-keys', title: 'API keys', desc: 'Manage public REST API credentials.' },
  { href: '/admin/audit', title: 'Audit log', desc: 'Every write captured with actor + diffs.' },
] as const

export default function AdminPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href as any} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{s.title}</CardTitle>
                  <CardDescription>{s.desc}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
